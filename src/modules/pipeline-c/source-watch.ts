import { PostKind, PostState } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { logger } from '../../config/logger.js';
import { llm } from '../../infra/llm/index.js';
import { scrapeThreadsPage, type RelayPost } from '../../infra/threads-relay.js';
import { shutdownPlaywrightBrowser } from '../../infra/playwright-threads-video.js';
import { videoFrameUrls } from '../../infra/video-frames.js';

/**
 * 소재 계정 감시 → 일상글 후보 자동 카드 (2026-10-12 사용자 결정 "자동화가 하나도 안 돼서 짜증").
 *
 * 전에 키워드 검색 자동 발굴은 엉뚱한 소재만 와서 실패(9월). 이번엔 **사용자가 직접 골라 준 해외 계정**의 새 글을 본다
 *   — 이미 좋은 소재를 올린다고 검증된 계정이라 정확도가 높다(10/12 시험: 29계정 392글 → 통과 20 → 바로 쓸 만 8).
 *
 * 흐름(매일 1회): 감시 계정 프로필 Relay 스크랩(무료) → 기준 통과 영상 → 계정 배정 → 영상 저장
 *   → 프레임 3장 + 원문으로 LLM 1회: 제외 판단(연예·이슈·연재·감성) + 짧은 한마디 후보 2개
 *   → 텔레그램 카드(①/② 버튼으로 문구 골라 승인). 발행은 승인 후 기존 페이싱 그대로.
 *
 * 감시 목록 = SeedSource 테이블(미사용이던 것 재활용 · 스키마 변경 없이). 통계는 notes(JSON).
 *   늘리기: ① 사용자가 보내는 URL 작성자 자동 추가 ② 감시 계정이 리포스트·인용한 **기준 통과** 글의 작성자 추가.
 *   정리: 추가 14일 지났는데 14일간 후보 0 → 비활성 · 후보를 3번 이상 리젝하고 승인 0 → 비활성.
 */

export type WatchVia = 'seed' | 'user_url' | 'quoted';
export interface WatchMeta {
  via: WatchVia;
  candidates: number;
  approved: number;
  rejected: number;
  lastCandidateAt?: string;
}

const MAX_AGE_DAYS = 3;
const LIKES_STRONG = 3000;
const LIKES_MIN_FOR_RATIO = 500;
const REPLY_RATIO = 0.015;
const PRUNE_DAYS = 14;
const DEFAULT_MAX_CARDS = 6;
/** 승인 대기 일상 카드가 이만큼 쌓여 있으면 새 카드 안 보냄(밀려서 묵는 것 방지). */
const MAX_PENDING_DAILY = 8;

function parseMeta(notes: string | null | undefined): WatchMeta {
  try {
    const m = JSON.parse(notes ?? '') as Partial<WatchMeta>;
    return { via: m.via ?? 'seed', candidates: m.candidates ?? 0, approved: m.approved ?? 0, rejected: m.rejected ?? 0, lastCandidateAt: m.lastCandidateAt };
  } catch {
    return { via: 'seed', candidates: 0, approved: 0, rejected: 0 };
  }
}

/** 감시 목록에 추가(이미 있으면 그대로 · 비활성이었으면 사용자 URL일 때만 되살림). 우리 계정은 제외. */
export async function addWatch(handle: string, via: WatchVia): Promise<void> {
  const h = handle.replace(/^@/, '').toLowerCase().trim();
  if (!h) return;
  const own = await prisma.account.findFirst({ where: { handle: h }, select: { id: true } });
  if (own) return;
  const existing = await prisma.seedSource.findUnique({ where: { handle: h } });
  if (existing) {
    if (!existing.isActive && via === 'user_url') {
      await prisma.seedSource.update({ where: { handle: h }, data: { isActive: true, lastError: null } });
    }
    return;
  }
  const meta: WatchMeta = { via, candidates: 0, approved: 0, rejected: 0 };
  await prisma.seedSource.create({ data: { handle: h, notes: JSON.stringify(meta) } });
  logger.info({ handle: h, via }, 'source-watch: 감시 계정 추가');
}

/** threads URL 에서 작성자 handle. */
export function handleFromThreadsUrl(url: string): string | null {
  return url.match(/threads\.(?:com|net)\/@([^/?#]+)\/post\//i)?.[1]?.toLowerCase() ?? null;
}

/** 카드 승인·리젝 결과를 감시 계정 통계에 반영. */
export async function recordWatchOutcome(handle: string, outcome: 'approved' | 'rejected'): Promise<void> {
  const row = await prisma.seedSource.findUnique({ where: { handle } });
  if (!row) return;
  const m = parseMeta(row.notes);
  m[outcome] += 1;
  await prisma.seedSource.update({ where: { handle }, data: { notes: JSON.stringify(m) } });
}

function passes(p: RelayPost): boolean {
  if (!p.media.some((m) => m.kind === 'video')) return false;
  if (!p.takenAt || Date.now() - p.takenAt.getTime() > MAX_AGE_DAYS * 864e5) return false;
  if (p.language === 'ko') return false; // 해외 바이럴만(한국서 이미 뜬 건 X)
  if (p.likes >= LIKES_STRONG) return true;
  return p.likes >= LIKES_MIN_FOR_RATIO && p.replies / Math.max(1, p.likes) >= REPLY_RATIO;
}

interface Judged {
  skip: boolean;
  reason?: string;
  situation?: string;
  candidates: string[];
}

const JUDGE_SYSTEM = `해외 바이럴 영상을 한국 Threads 일상글로 올릴지 판단하고, 붙일 한마디를 만든다.

[제외 판단] 하나라도 해당하면 skip=true:
- 연예인·인플루언서·정치·사건 뉴스 등 그 나라 이슈(한국 독자가 모름)
- 연재물(앞 이야기를 알아야 이해되는 "○○ 오늘은…" 류)
- 감동·힐링·교훈이 핵심인 영상(우리 실측 반응 약함)
- 사고·부상·혐오·선정적 장면
- 프레임만으로 무슨 영상인지 전혀 파악 안 됨

[문구] skip=false면 후보 2개 (2026-10-19 사용자: "왜 원본 본문 내용이 아니냐"):
- ① **원문 캡션을 한국 말맛으로 옮긴 것** — 원문의 뜻·웃음 포인트를 그대로, 한국 사람이 쓴 것처럼 자연스럽게(직역 금지). 원문 길이 정도로 짧게.
  예) "こんなふうに出迎えられたら 疲れがぶっ飛んだよ〜🥰" → "이렇게 마중 나와주면 피로가 싹 날아감🥰"
  원문이 이모지뿐이거나 내용이 없으면 ①도 반응 한마디로.
- ② 단어 몇 개짜리 반응 한마디. 궁금해서 끝까지 보게 만드는 훅. 예: "겁나 웃기네ㅋㅋㅋ", "입은 거짓말 못하네ㅋㅋㅋ".
- 공통: 영상 장면을 글로 설명하지 마라 · 질문·감성·교훈 멘트 금지 · 프레임에서 확인 안 되는 결말 추측 금지.
JSON만: {"skip": boolean, "reason": "skip 사유(없으면 빈 문자열)", "situation": "영상이 뭔지 한 줄(내부용)", "candidates": ["한마디1", "한마디2"]}`;

export async function judge(caption: string, videoUrl: string): Promise<Judged> {
  const res = await llm().complete({
    tier: 'main',
    system: JUDGE_SYSTEM,
    thinking: 'disabled',
    temperature: 0.6,
    maxOutputTokens: 400,
    jsonMode: true,
    userParts: [
      { type: 'text', text: `원문 캡션: "${caption.slice(0, 400)}"` },
      ...videoFrameUrls(videoUrl).map((u) => ({ type: 'image' as const, url: u })),
    ],
  });
  const m = res.text.match(/\{[\s\S]*\}/);
  const j = (m ? JSON.parse(m[0]) : {}) as Partial<Judged>;
  const candidates = (j.candidates ?? []).map((c) => String(c).trim()).filter((c) => c.length > 0 && c.length <= 60).slice(0, 2);
  return { skip: Boolean(j.skip) || candidates.length === 0, reason: j.reason || (candidates.length ? undefined : '한마디 후보 없음'), situation: j.situation, candidates };
}

/** 오늘 일상글이 가장 적은 활성 계정(돌려막기) — bot.ts pickLeastUsedDailyAccount 와 같은 기준. */
export async function pickAccount(): Promise<{ id: string; handle: string } | null> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const live = { notIn: [PostState.REJECTED, PostState.FAILED] as PostState[] };
  const accs = await prisma.account.findMany({ where: { isActive: true }, select: { id: true, handle: true } });
  if (accs.length === 0) return null;
  const rows = await Promise.all(
    accs.map(async (a) => ({
      a,
      c: await prisma.post.count({ where: { accountId: a.id, createdAt: { gte: today }, state: live } }),
      t: (await prisma.post.findFirst({ where: { accountId: a.id, state: live }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }))?.createdAt.getTime() ?? 0,
    })),
  );
  rows.sort((x, y) => x.c - y.c || x.t - y.t);
  return rows[0]!.a;
}

export interface SourceWatchSummary {
  watched: number;
  scanned: number;
  passed: number;
  cards: number;
  skipped: Array<{ url: string; reason: string }>;
  added: string[];
  pruned: string[];
  note?: string;
}

export async function runSourceWatch(opts: { maxCards?: number; dryRun?: boolean } = {}): Promise<SourceWatchSummary> {
  const maxCards = opts.maxCards ?? DEFAULT_MAX_CARDS;
  const summary: SourceWatchSummary = { watched: 0, scanned: 0, passed: 0, cards: 0, skipped: [], added: [], pruned: [] };
  const watches = await prisma.seedSource.findMany({ where: { isActive: true } });
  summary.watched = watches.length;
  const watchSet = new Set(watches.map((w) => w.handle));

  const used = new Set(
    (await prisma.inboundLink.findMany({ select: { url: true } }))
      .map((l) => l.url.match(/post\/([^/?#]+)/)?.[1])
      .filter((c): c is string => Boolean(c)),
  );

  // 1) 스크랩 + 후보 + 확장
  const cands = new Map<string, RelayPost>();
  try {
    for (const w of watches) {
      try {
        const posts = await scrapeThreadsPage(`https://www.threads.com/@${w.handle}`, { scrolls: 1, locale: 'ja-JP' });
        summary.scanned += posts.length;
        for (const p of posts) {
          if (!p.username || used.has(p.code) || !passes(p)) continue;
          cands.set(p.code, p);
          const author = p.username.toLowerCase();
          // 감시 계정이 리포스트한 남의 글 / 인용한 원본 작성자 → 감시 확장 (기준 통과 글만)
          for (const h of [author !== w.handle ? author : null, p.quotedUsername?.toLowerCase() ?? null]) {
            if (h && !watchSet.has(h)) {
              await addWatch(h, 'quoted');
              watchSet.add(h);
              summary.added.push(h);
            }
          }
        }
        await prisma.seedSource.update({ where: { id: w.id }, data: { lastPolledAt: new Date(), lastError: null } });
      } catch (err) {
        await prisma.seedSource.update({ where: { id: w.id }, data: { lastPolledAt: new Date(), lastError: (err as Error).message.slice(0, 300) } });
        logger.warn({ handle: w.handle, err: (err as Error).message }, 'source-watch: 스크랩 실패');
      }
    }
  } finally {
    await shutdownPlaywrightBrowser().catch(() => {});
  }
  summary.passed = cands.size;

  // 2) 카드 (대기 카드가 이미 많으면 쉼)
  const pendingDaily = await prisma.post.count({ where: { kind: PostKind.DAILY, state: PostState.PENDING_APPROVAL } });
  const room = Math.max(0, Math.min(maxCards, MAX_PENDING_DAILY - pendingDaily));
  if (room === 0) summary.note = `승인 대기 일상 카드 ${pendingDaily}장 → 새 카드 보류`;
  const ranked = [...cands.values()].sort((a, b) => b.likes - a.likes);
  const { runPipelineC } = await import('./orchestrator.js');
  const { sendApprovalRequest } = await import('../shared/approval-gate/service.js');
  for (const p of ranked) {
    if (summary.cards >= room || opts.dryRun) break;
    const url = `https://www.threads.com/@${p.username}/post/${p.code}`;
    const acc = await pickAccount();
    if (!acc) break;
    try {
      const out = await runPipelineC({ accountId: acc.id, sourceUrl: url, holdApproval: true, bodyOverride: '' });
      if (out.status !== 'PENDING_APPROVAL' || !('postId' in out) || !out.postId) {
        summary.skipped.push({ url, reason: `파이프라인: ${'reason' in out ? out.reason : out.status}` });
        continue;
      }
      const post = await prisma.post.findUniqueOrThrow({ where: { id: out.postId }, select: { mediaUrls: true, sourceBrief: true } });
      const video = post.mediaUrls.find((u) => u.includes('/video/upload/'));
      if (!video) {
        await prisma.post.update({ where: { id: out.postId }, data: { state: PostState.REJECTED, rejectionReason: 'source-watch: 영상 확보 실패' } });
        summary.skipped.push({ url, reason: '영상 확보 실패' });
        continue;
      }
      const j = await judge(p.text, video);
      const handle = (p.username ?? '').toLowerCase();
      if (j.skip) {
        await prisma.post.update({ where: { id: out.postId }, data: { state: PostState.REJECTED, rejectionReason: `source-watch 제외: ${j.reason ?? ''}` } });
        summary.skipped.push({ url, reason: j.reason ?? '제외' });
        continue;
      }
      await prisma.post.update({
        where: { id: out.postId },
        data: {
          generatedBody: j.candidates[0],
          sourceBrief: {
            ...((post.sourceBrief as object | null) ?? {}),
            rationale: { situation: j.situation ?? null, point: `원본 좋아요 ${p.likes.toLocaleString()} · 댓글 ${p.replies}` },
            watch: handle,
            altBodies: j.candidates,
          } as never,
        },
      });
      await sendApprovalRequest(out.postId);
      const row = await prisma.seedSource.findUnique({ where: { handle } });
      if (row) {
        const m = parseMeta(row.notes);
        m.candidates += 1;
        m.lastCandidateAt = new Date().toISOString();
        await prisma.seedSource.update({ where: { handle }, data: { notes: JSON.stringify(m) } });
      }
      summary.cards += 1;
    } catch (err) {
      summary.skipped.push({ url, reason: (err as Error).message.slice(0, 120) });
      logger.warn({ url, err: (err as Error).message }, 'source-watch: 후보 처리 실패');
    }
  }

  // 3) 정리
  const now = Date.now();
  for (const w of await prisma.seedSource.findMany({ where: { isActive: true } })) {
    const m = parseMeta(w.notes);
    const old = now - w.addedAt.getTime() > PRUNE_DAYS * 864e5;
    const lastCand = m.lastCandidateAt ? new Date(m.lastCandidateAt).getTime() : w.addedAt.getTime();
    const dry = old && now - lastCand > PRUNE_DAYS * 864e5;
    const disliked = m.rejected >= 3 && m.approved === 0;
    if (dry || disliked) {
      await prisma.seedSource.update({ where: { id: w.id }, data: { isActive: false, lastError: dry ? `${PRUNE_DAYS}일 후보 없음` : '리젝 3+ · 승인 0' } });
      summary.pruned.push(w.handle);
    }
  }

  logger.info({ ...summary, skipped: summary.skipped.length }, 'source-watch done');
  return summary;
}

/** 관리자 텔레그램 요약. */
export function sourceWatchReport(s: SourceWatchSummary): string {
  const lines = [
    `🔭 소재 감시: 계정 ${s.watched}곳 · 글 ${s.scanned}건 → 기준 통과 ${s.passed} → 카드 ${s.cards}장`,
  ];
  if (s.note) lines.push(`⏸ ${s.note}`);
  if (s.skipped.length) lines.push(`제외 ${s.skipped.length}: ` + s.skipped.slice(0, 5).map((x) => x.reason).join(' · '));
  if (s.added.length) lines.push(`➕ 감시 추가: ${s.added.join(', ')}`);
  if (s.pruned.length) lines.push(`➖ 감시 정리: ${s.pruned.join(', ')}`);
  return lines.join('\n');
}

