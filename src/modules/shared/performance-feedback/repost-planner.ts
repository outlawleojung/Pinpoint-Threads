import { PostKind, PostState } from '@prisma/client';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { NEW_ACCOUNT_CLAIM, tenureClaimOk } from '../../pipeline-b/sharing-repost.js';

/**
 * Repost Planner — 재탕(재발행) 엔진.
 *
 * 강의 정본(docs/00-overview/course-tactics.md §4, course-feedback-1/2.md):
 *   "조회·비율 좋은 글은 원문 그대로, 텀을 두고 다시 올려라 — 재활용 무기고가 수익 엔진."
 *
 * 기존 propagation(타 계정 재생성 · 본문조회 1만 절대기준)과 다르다:
 *   - 재생성 X → **원문 그대로 복제**(본문·미디어·고정댓글).
 *   - 절대 1만 X → **비율 기준**(작은 계정도 위너가 나온다).
 *
 * 이 모듈은 **계획만** 산출(side-effect 없음). 복제 카드 생성은 createRepost().
 */

/** 위너 판정에 쓰는 스냅샷 최소 경과 시간(h). 강의: 휘발성 3~5일 → 72h면 성과가 거의 확정. */
const MIN_SNAPSHOT_HOURS = 72;
/** 조회 이 이상이면 비율 무관 위너 (강의: "조회 1000 넘으면 무조건 재사용"). */
const VIEWS_ALWAYS = 1000;
/** 비율 판정 최소 조회 (표본 너무 작으면 비율이 노이즈). */
const VIEWS_MIN_FOR_RATIO = 300;
/** 쇼핑 = 댓글조회/본문조회 ≥ 10% (강의 KPI · 링크 반응률 대리지표). */
const SHOPPING_REPLY_RATIO = 0.1;
/** 일상·스하리 = 좋아요/조회 ≥ 8% (강의: "8% 이상이면 좋은 글"). */
const LIKE_RATIO = 0.08;
/** 쇼핑 = 비율 낮아도 댓글조회 절대수 이 이상이면 위너 (피드백3: "댓글조회 1천 넘으면 바로 다시 씀"). */
const REPLY_VIEWS_ALWAYS = 1000;
/** 재탕 성과가 원본의 이 비율 미만이면 "낮게 나옴" → 텀을 늘려 재도전 (4강: 재도전 무제한, 간격만 늘림). */
const LOW_REPOST_RATIO = 0.3;
/** 낮게 나온 재탕 1회당 텀 배수 ×2, 최대 이 배수. */
const MAX_COOLDOWN_MULT = 8;
/**
 * 스하리 위너 (2026-10-03 사용자 결정 "반응 좋았던 스하리 글 재탕").
 *   스하리는 태그 검색 노출이라 1천 넘는 글이 없음(최대 891) → 일반 기준(1천 / 300+&8%)이면 후보 0.
 *   스하리 안에서 상위권 = 조회 300+ 또는 (조회 100+ & 좋아요/조회 8%+).
 */
const SHARING_VIEWS_GOOD = 300;
const SHARING_RATIO_MIN_VIEWS = 100;

/**
 * 1인칭 관계어로 화자 성별 추정 (4강: 계정 페르소나와 화자 일치 — 여성 계정에 "와이프한테" X).
 * 원 계정에선 자연스러운 글이 다른 계정으로 재탕될 때만 문제가 되므로 이관 시 검사한다.
 */
function impliedSpeakerGender(body: string): 'male' | 'female' | null {
  const femaleSpeaker = /남편|남친|남자친구|오빠가|시어머니|시댁|신랑/.test(body);
  const maleSpeaker = /와이프|아내|여친|여자친구|마누라|장모님|처가/.test(body);
  if (femaleSpeaker && !maleSpeaker) return 'female';
  if (maleSpeaker && !femaleSpeaker) return 'male';
  return null;
}

function speakerFits(body: string, accGender: string): boolean {
  const sp = impliedSpeakerGender(body);
  if (!sp || accGender === 'unisex') return true;
  return sp === accGender;
}

/**
 * 재탕 텀(일) — 계보(원본+재탕들)의 마지막 발행 이후. **전 종류 최소 7일.**
 *   강의 피드백1강: "재탕 7일+, 초대박은 1개월/6개월". 2강: 텀은 계정 보호용(팔로워 2~3천급은 텀 없이도 OK) → 작은 계정은 길게.
 *   사용자 결정(2026-10-03): 쇼핑·일상·스하리 모두 일주일 이상 지난 글만.
 */
export const REPOST_COOLDOWN_DAYS: Record<PostKind, number> = {
  [PostKind.SHOPPING]: 7,
  [PostKind.DAILY]: 7,
  [PostKind.SHARING]: 7,
};

/** CLAUDE.md 하드룰: 계정별 14일 이내 동일 상품 금지 → 쇼핑 재탕은 이 안이면 다른 계정으로. */
const SAME_PRODUCT_LOOKBACK_DAYS = 14;

export interface RepostCandidate {
  rootPostId: string;
  kind: PostKind;
  originHandle: string;
  bodyPreview: string;
  views: number;
  likes: number;
  replyViews: number | null;
  basis: string; // 위너 근거
  lastPublishedAt: Date;
  repostCount: number;
  /** 재발행할 계정(같은 계정 우선, 쇼핑 14일 룰이면 다른 적격 계정). null = 지금 올릴 계정 없음. */
  targetAccountId: string | null;
  targetHandle: string | null;
  targetReason: string;
}

/** 링크 없는 테스트 글 = 일상 슬롯(DAILY)으로 나간 상품글. 위너면 링크 계정에서 쇼핑글로 승격(순환 ②→④). */
function isLinklessTest(p: { kind: PostKind; commerceProductId: string | null }): boolean {
  return p.kind === PostKind.DAILY && p.commerceProductId != null;
}

function winnerBasis(
  kind: PostKind,
  s: { views: number; likes: number; replyViews: number | null },
): string | null {
  if (s.views >= VIEWS_ALWAYS) return `조회 ${s.views} ≥ ${VIEWS_ALWAYS}`;
  if (kind === PostKind.SHOPPING && s.replyViews != null && s.replyViews >= REPLY_VIEWS_ALWAYS) {
    return `댓글조회 ${s.replyViews} ≥ ${REPLY_VIEWS_ALWAYS}`;
  }
  if (kind === PostKind.SHARING) {
    if (s.views >= SHARING_VIEWS_GOOD) return `스하리 조회 ${s.views} ≥ ${SHARING_VIEWS_GOOD}`;
    if (s.views < SHARING_RATIO_MIN_VIEWS) return null;
    const r = s.likes / s.views;
    return r >= LIKE_RATIO ? `스하리 좋아요/조회 ${(r * 100).toFixed(1)}% ≥ 8%` : null;
  }
  if (s.views < VIEWS_MIN_FOR_RATIO) return null;
  if (kind === PostKind.SHOPPING) {
    if (s.replyViews == null) return null;
    const r = s.replyViews / s.views;
    return r >= SHOPPING_REPLY_RATIO ? `댓글조회/조회 ${(r * 100).toFixed(1)}% ≥ 10%` : null;
  }
  const r = s.likes / s.views;
  return r >= LIKE_RATIO ? `좋아요/조회 ${(r * 100).toFixed(1)}% ≥ 8%` : null;
}

/** 재탕 후보 산출. 위너 + 텀 경과 + 진행 중 재탕 없음 + 올릴 계정 있음. */
export async function planReposts(now = new Date()): Promise<RepostCandidate[]> {
  // 원본(root)만 대상. 재탕글의 성과는 원본 계보로 합쳐 본다(여기선 원본 스냅샷 기준).
  const roots = await prisma.post.findMany({
    where: { state: PostState.PUBLISHED, repostOfId: null, publishedAt: { not: null } },
    select: {
      id: true,
      kind: true,
      accountId: true,
      commerceProductId: true,
      generatedBody: true,
      publishedAt: true,
      account: { select: { handle: true, isActive: true, audienceGender: true } },
      insightSnapshots: {
        orderBy: { hoursAfterPublish: 'desc' },
        select: { hoursAfterPublish: true, views: true, likes: true, replyViews: true },
      },
      reposts: {
        select: {
          state: true,
          publishedAt: true,
          scheduledAt: true,
          insightSnapshots: { orderBy: { hoursAfterPublish: 'desc' }, take: 1, select: { hoursAfterPublish: true, views: true } },
        },
      },
    },
  });

  const out: RepostCandidate[] = [];
  for (const p of roots) {
    const snap = p.insightSnapshots.find((s) => s.hoursAfterPublish >= MIN_SNAPSHOT_HOURS);
    if (!snap) continue;
    const basis = winnerBasis(p.kind, snap);
    // 스하리 "계정 처음 만들었어" 류 신생 주장은 숫자 보정으로 못 고침 → 재탕 후보 제외
    if (p.kind === PostKind.SHARING && NEW_ACCOUNT_CLAIM.test(p.generatedBody ?? '')) continue;
    if (!basis) continue;

    // 진행 중(승인 대기·예약·발행 중) 재탕이 있으면 중복 생성 X
    const inFlight = p.reposts.some((r) =>
      ([PostState.PENDING_APPROVAL, PostState.APPROVED, PostState.PUBLISHING, PostState.COPYWRITING] as PostState[]).includes(r.state),
    );
    if (inFlight) continue;

    const published = [p.publishedAt!, ...p.reposts.filter((r) => r.state === PostState.PUBLISHED && r.publishedAt).map((r) => r.publishedAt!)];
    const lastPublishedAt = new Date(Math.max(...published.map((d) => d.getTime())));
    // 낮게 나온 재탕 수만큼 텀 ×2 (버리지 않고 간격만 늘려 재도전 · 4강 "한 번 떴던 글은 다시 뜬다")
    const lowCount = p.reposts.filter((r) => {
      const s = r.insightSnapshots[0];
      return r.state === PostState.PUBLISHED && s && s.hoursAfterPublish >= MIN_SNAPSHOT_HOURS && s.views < snap.views * LOW_REPOST_RATIO;
    }).length;
    const mult = Math.min(2 ** lowCount, MAX_COOLDOWN_MULT);
    // 테스트 위너 승격도 쇼핑 재탕 텀(7일)
    const cooldownMs = REPOST_COOLDOWN_DAYS[isLinklessTest(p) ? PostKind.SHOPPING : p.kind] * mult * 864e5;
    if (now.getTime() - lastPublishedAt.getTime() < cooldownMs) continue;

    const target = await pickTarget(p, now);
    out.push({
      rootPostId: p.id,
      kind: p.kind,
      originHandle: p.account.handle,
      bodyPreview: (p.generatedBody ?? '').replace(/\s+/g, ' ').slice(0, 50),
      views: snap.views,
      likes: snap.likes,
      replyViews: snap.replyViews,
      basis: lowCount > 0 ? `${basis} · 저조 재탕 ${lowCount}회 → 텀 ×${mult}` : basis,
      lastPublishedAt,
      repostCount: p.reposts.filter((r) => r.state === PostState.PUBLISHED).length,
      targetAccountId: target?.id ?? null,
      targetHandle: target?.handle ?? null,
      targetReason: target?.reason ?? '올릴 적격 계정 없음',
    });
  }

  // 성과 좋은 순
  out.sort((a, b) => b.views - a.views);
  logger.info({ candidates: out.length }, 'repost plan');
  return out;
}

/**
 * 재탕 계정 선택. 원 계정이 활성이면 우선.
 * 쇼핑은 14일 동일상품 룰 → 원 계정이 14일 내 그 상품을 올렸으면 다른 활성 계정(최근 14일 해당 상품 없는 곳).
 */
async function pickTarget(
  p: {
    id: string;
    accountId: string;
    kind: PostKind;
    commerceProductId: string | null;
    generatedBody: string | null;
    account: { handle: string; isActive: boolean; audienceGender: string };
  },
  now: Date,
): Promise<{ id: string; handle: string; reason: string } | null> {
  const body = p.generatedBody ?? '';
  const since = new Date(now.getTime() - SAME_PRODUCT_LOOKBACK_DAYS * 864e5);
  const hasRecentSameProduct = async (accountId: string) =>
    p.commerceProductId
      ? (await prisma.post.count({
          where: {
            accountId,
            commerceProductId: p.commerceProductId,
            state: { notIn: [PostState.REJECTED, PostState.FAILED] },
            OR: [{ publishedAt: { gte: since } }, { scheduledAt: { gte: since } }, { createdAt: { gte: since } }],
          },
        })) > 0
      : false;

  const needsProductRule = p.kind === PostKind.SHOPPING;
  const { isShoppingEligible, LINK_MIN_FOLLOWERS } = await import('../../pipeline-a/reach-health.js');

  // ★ 테스트 위너 승격: 링크 적격 계정(원 계정 포함)에서 고정댓글 붙여 쇼핑글로. 없으면 원 계정에 링크 없이 재탕.
  if (isLinklessTest(p)) {
    const all = await prisma.account.findMany({
      where: { isActive: true },
      select: { id: true, handle: true, audienceGender: true, followersCount: true },
      orderBy: { handle: 'asc' },
    });
    const ordered = [...all.filter((a) => a.id === p.accountId), ...all.filter((a) => a.id !== p.accountId)];
    for (const a of ordered) {
      if (a.id !== p.accountId && !speakerFits(body, a.audienceGender)) continue;
      if (!(await isShoppingEligible(a.id, a.followersCount)).ok) continue;
      // 14일 룰: 원 계정의 테스트 글 자체는 링크 없는 글이라 제외하고 본다
      const dup = await prisma.post.count({
        where: {
          accountId: a.id,
          commerceProductId: p.commerceProductId,
          kind: PostKind.SHOPPING,
          state: { notIn: [PostState.REJECTED, PostState.FAILED] },
          createdAt: { gte: since },
        },
      });
      if (dup > 0) continue;
      return { id: a.id, handle: a.handle, reason: `🧪 테스트 위너 → 💰 링크 달고 쇼핑글로 승격` };
    }
    if (p.account.isActive) return { id: p.accountId, handle: p.account.handle, reason: '링크 가능 계정 없음 → 원 계정에 링크 없이 재탕' };
    return null;
  }

  if (p.kind !== PostKind.SHARING && p.account.isActive && (!needsProductRule || !(await hasRecentSameProduct(p.accountId)))) {
    if (!needsProductRule) return { id: p.accountId, handle: p.account.handle, reason: '원 계정' };
    const origin = await prisma.account.findUnique({ where: { id: p.accountId }, select: { followersCount: true } });
    const elig = await isShoppingEligible(p.accountId, origin?.followersCount);
    if (elig.ok) return { id: p.accountId, handle: p.account.handle, reason: '원 계정' };
    // 300 미만: 검증된 쇼핑 글을 링크 없이 일상글로 재탕(반응 테스트 · 발행량 유지). 발행기가 링크를 뗀다.
    if ((origin?.followersCount ?? 0) < LINK_MIN_FOLLOWERS) {
      return { id: p.accountId, handle: p.account.handle, reason: `원 계정 · 팔로워<${LINK_MIN_FOLLOWERS} → 링크 없이 일상글로` };
    }
    // 300+인데 도달 억제 → 원 계정 링크 X, 다른 적격 계정 탐색
  }
  // 스하리: 원 계정이 쉬고 있으면 **다른 활성 계정이 그 글을 다시 써본다** (2026-10-03 사용자 결정).
  //   스하리 글은 계정 고유 사연이 아니라 소통 멘트 → 이관 가능. 팔로워 숫자는 createRepost 에서 대상 계정 기준으로 보정.
  //   대상 = 화자 성별 맞고, 오늘 스하리 아직 없고, 최근 7일 안에 같은 계보 글을 안 올린 계정 중 스하리가 가장 오래된 곳.
  if (p.kind === PostKind.SHARING) {
    const { consecutiveSharingBlock } = await import('../publisher/scheduler.js');
    // 원 계정이 활성인데 직전 글이 스하리면 원 계정 대신 다른 계정 탐색 (스하리 연속 금지 · 2026-10-04)
    if (p.account.isActive && !(await consecutiveSharingBlock(p.accountId, { includeQueued: true }))) {
      return { id: p.accountId, handle: p.account.handle, reason: '원 계정' };
    }
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);
    const week = new Date(now.getTime() - 7 * 864e5);
    const others = await prisma.account.findMany({
      where: { isActive: true, id: { not: p.accountId } },
      select: { id: true, handle: true, audienceGender: true, threadsCreatedAt: true },
    });
    let best: { id: string; handle: string; last: number } | null = null;
    for (const a of others) {
      if (!speakerFits(body, a.audienceGender)) continue;
      if (!tenureClaimOk(body, a.threadsCreatedAt, now)) continue; // 신생 계정에 "몇 달째" 글 X
      if (await consecutiveSharingBlock(a.id, { includeQueued: true })) continue; // 직전 글이 스하리면 X
      const live = { notIn: [PostState.REJECTED, PostState.FAILED] as PostState[] };
      const today = await prisma.post.count({ where: { accountId: a.id, kind: PostKind.SHARING, createdAt: { gte: dayStart }, state: live } });
      if (today > 0) continue;
      const sameLine = await prisma.post.count({
        where: { accountId: a.id, state: live, createdAt: { gte: week }, OR: [{ id: p.id }, { repostOfId: p.id }] },
      });
      if (sameLine > 0) continue;
      const last = await prisma.post.findFirst({
        where: { accountId: a.id, kind: PostKind.SHARING, state: live },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const t = last?.createdAt.getTime() ?? 0;
      if (!best || t < best.last) best = { id: a.id, handle: a.handle, last: t };
    }
    return best ? { id: best.id, handle: best.handle, reason: `원 계정(${p.account.handle}) 휴식 → 다른 계정이 다시 써봄` } : null;
  }
  if (!needsProductRule) return null; // 일상은 원 계정 비활성이면 스킵(영상 소재 계정 고유)

  const others = await prisma.account.findMany({
    where: { isActive: true, id: { not: p.accountId } },
    select: { id: true, handle: true, audienceGender: true, followersCount: true },
    orderBy: { handle: 'asc' },
  });
  for (const a of others) {
    // 원문 1인칭 관계어(남편/와이프 등)가 이 계정 성별과 안 맞으면 제외 (페르소나-화자 일치)
    if (!speakerFits(body, a.audienceGender)) continue;
    // 쇼핑 적격(도달 게이트 · 신생 폴백 팔로워 300) — 신규 쇼핑과 동일 기준
    if (!(await isShoppingEligible(a.id, a.followersCount)).ok) continue;
    if (!(await hasRecentSameProduct(a.id))) return { id: a.id, handle: a.handle, reason: '14일 동일상품 룰 → 다른 계정(화자 일치 확인)' };
  }
  return null;
}

/**
 * 재탕 카드 생성 — 원본을 **그대로** 복제한 새 Post(PENDING_APPROVAL)를 만든다.
 * 이후 기존 승인 카드·페이싱(4h·종류별 하루 캡) 그대로 통과한다.
 */
export async function createRepost(rootPostId: string, targetAccountId: string): Promise<string> {
  const root = await prisma.post.findUniqueOrThrow({
    where: { id: rootPostId },
    select: {
      kind: true,
      sourceItemId: true,
      commerceProductId: true,
      generatedBody: true,
      generatedReply: true,
      sourceBrief: true,
      mediaUrls: true,
      sourceMediaUrls: true,
      replyVariantUsed: true,
      repostOfId: true,
    },
  });

  // ★ 테스트 위너 승격: 대상이 링크 적격이면 kind=SHOPPING + 고정댓글(딥링크) 새로 생성.
  let kind = root.kind;
  let generatedReply = root.generatedReply;
  if (root.kind === PostKind.DAILY && root.commerceProductId) {
    const [target, product] = await Promise.all([
      prisma.account.findUniqueOrThrow({ where: { id: targetAccountId }, select: { id: true, followersCount: true, personaPrompt: true } }),
      prisma.commerceProduct.findUniqueOrThrow({ where: { id: root.commerceProductId }, select: { productName: true, category: true, deeplinkUrl: true, channel: true } }),
    ]);
    const { isShoppingEligible } = await import('../../pipeline-a/reach-health.js');
    if ((await isShoppingEligible(target.id, target.followersCount)).ok && product.deeplinkUrl) {
      const { composeReply } = await import('../../pipeline-a/reply-composer/index.js');
      const reply = await composeReply({
        body: root.generatedBody ?? '',
        productName: product.productName,
        productCategory: product.category ?? undefined,
        deeplinkUrl: product.deeplinkUrl,
        accountId: target.id,
        personaPrompt: target.personaPrompt ?? undefined,
        channel: product.channel as 'COUPANG' | 'MUSINSA' | 'NAVER',
      });
      kind = PostKind.SHOPPING;
      generatedReply = reply.text;
      logger.info({ rootPostId, targetAccountId }, 'repost: 테스트 위너 → 쇼핑글 승격(고정댓글 생성)');
    }
  }

  // 스하리 재탕: 팔로워 숫자 현재값으로 보정 + 첨부는 보관함 소재로 교체(어그로용 · 글과 무관) — 2026-10-03 사용자 결정
  let generatedBody = root.generatedBody;
  let mediaUrls = root.mediaUrls;
  if (root.kind === PostKind.SHARING) {
    const { refreshFollowerClaims, pickSharingAsset } = await import('../../pipeline-b/sharing-repost.js');
    const target = await prisma.account.findUniqueOrThrow({ where: { id: targetAccountId }, select: { followersCount: true, threadsCreatedAt: true } });
    const fixed = await refreshFollowerClaims(root.generatedBody ?? '', target.followersCount ?? 0);
    if (fixed == null) throw new Error('스하리 재탕: 팔로워 숫자 보정 실패 → 재탕 보류');
    if (!tenureClaimOk(fixed, target.threadsCreatedAt)) throw new Error('스하리 재탕: "몇 달째" 류 주장인데 대상 계정이 60일 미만 → 재탕 보류');
    generatedBody = fixed;
    const asset = await pickSharingAsset();
    if (asset) mediaUrls = [asset];
    else if (mediaUrls.length === 0) throw new Error('스하리 재탕: 첨부 보관함이 비어 있음 → 소재 추가 후 재시도');
  }

  const created = await prisma.post.create({
    data: {
      state: PostState.PENDING_APPROVAL,
      kind,
      accountId: targetAccountId,
      sourceItemId: root.sourceItemId,
      commerceProductId: root.commerceProductId,
      generatedBody,
      generatedReply,
      sourceBrief: root.sourceBrief ?? undefined,
      mediaUrls,
      sourceMediaUrls: root.sourceMediaUrls,
      replyVariantUsed: root.replyVariantUsed,
      repostOfId: root.repostOfId ?? rootPostId, // 항상 원본(root)을 가리키게
    },
    select: { id: true },
  });
  logger.info({ rootPostId, newPostId: created.id, targetAccountId }, 'repost card created');
  return created.id;
}
