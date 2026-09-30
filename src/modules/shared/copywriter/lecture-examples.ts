import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../../../config/logger.js';
import { embedOne, isVoyageConfigured, VOYAGE_DIM } from '../../../infra/voyage-client.js';

/**
 * 강의 실전 사례 라이브러리 → 카피 생성 본보기(few-shot).
 *
 * 배경(2026-09-30): 강의 60시간을 추상 규칙("두괄식·공감")으로 요약해 넣었더니 생성 결과가 전혀 안 바뀜.
 *   → 전사 원문 13개에서 실제 게시글 사례 1,007건(문구·성과·강사 이유·맞는 상황)을 전수 추출
 *     (data/lecture-cases.json · 검수 목록 docs/00-overview/lecture-case-library.md).
 *   원본이 들어오면 **가장 비슷한 성공 사례 + 실패 사례**를 골라 생성기에 보여주고 그 틀로 쓰게 한다.
 *
 * 검색: Voyage 임베딩(사례는 data/lecture-cases.emb.bin 에 미리 계산 · 원본은 호출당 1회 임베딩).
 *   Voyage 실패/미설정 시 글자 2-gram 겹침으로 폴백 (생성은 멈추지 않는다).
 */

export interface LectureCase {
  id: string;
  lecture: string;
  lecture_name: string;
  ts: string;
  kind: 'shopping' | 'daily' | 'sharing' | 'reply' | 'other';
  verdict: 'win' | 'fail' | 'fix' | 'template';
  text: string;
  original: string | null;
  result: string | null;
  subject: string | null;
  types: string[];
  why: string | null;
  applies_when: string | null;
}

// 프로젝트 루트 기준 (다른 모듈과 동일 관례: process.cwd())
const DATA_DIR = resolve(process.cwd(), 'src/modules/shared/copywriter/data');

let cache: { cases: LectureCase[]; vecs: Float32Array | null } | null = null;
/** 같은 원본의 재생성(사실검사 재시도 등)에서 임베딩 재호출 방지 (Voyage 무결제 3 RPM). */
const queryCache = new Map<string, number[]>();

function load(): { cases: LectureCase[]; vecs: Float32Array | null } {
  if (cache) return cache;
  const cases = JSON.parse(readFileSync(join(DATA_DIR, 'lecture-cases.json'), 'utf-8')) as LectureCase[];
  let vecs: Float32Array | null = null;
  const binPath = join(DATA_DIR, 'lecture-cases.emb.bin');
  if (existsSync(binPath)) {
    const buf = readFileSync(binPath);
    const arr = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    if (arr.length === cases.length * VOYAGE_DIM) vecs = arr;
    else logger.warn({ vecs: arr.length / VOYAGE_DIM, cases: cases.length }, 'lecture-cases 임베딩 개수 불일치 → 키워드 폴백');
  }
  cache = { cases, vecs };
  return cache;
}

function cosineAt(vecs: Float32Array, i: number, q: number[]): number {
  let dot = 0;
  let a = 0;
  let b = 0;
  const off = i * VOYAGE_DIM;
  for (let k = 0; k < VOYAGE_DIM; k++) {
    const x = vecs[off + k]!;
    const y = q[k]!;
    dot += x * y;
    a += x * x;
    b += y * y;
  }
  return dot / (Math.sqrt(a) * Math.sqrt(b) || 1);
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s\W_]+/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

function lexical(c: LectureCase, qb: Set<string>): number {
  const cb = bigrams(`${c.subject ?? ''} ${c.text} ${c.applies_when ?? ''}`);
  let hit = 0;
  for (const g of qb) if (cb.has(g)) hit++;
  return hit / Math.max(8, Math.sqrt(qb.size * cb.size));
}

/** 성공 사례 가중치 — 성과 수치 있는 실전 글 > 강사 수정안 > 템플릿. */
function weight(c: LectureCase): number {
  let w = 0;
  if (c.verdict === 'win') w += c.result ? 0.04 : 0.02;
  if (c.verdict === 'fix') w += 0.03;
  if (c.why) w += 0.01;
  return w;
}

export interface LectureExamples {
  good: LectureCase[];
  bad: LectureCase[];
  method: 'embedding' | 'lexical';
}

/**
 * 원본과 비슷한 강의 사례 선택. kind: 쇼핑 카피면 'shopping', 일상글이면 'daily'.
 */
export async function findLectureExamples(args: {
  kind: 'shopping' | 'daily';
  query: string;
  goodK?: number;
  badK?: number;
}): Promise<LectureExamples> {
  const { cases, vecs } = load();
  const goodK = args.goodK ?? 5;
  const badK = args.badK ?? 2;
  const kinds = args.kind === 'shopping' ? new Set(['shopping', 'reply']) : new Set(['daily', 'sharing']);
  const pool = cases.map((c, i) => ({ c, i })).filter(({ c }) => kinds.has(c.kind) && c.text.replace(/[\s…]/g, '').length >= 6);

  let method: LectureExamples['method'] = 'lexical';
  let score: (i: number, c: LectureCase) => number;
  let q: number[] | null = null;
  if (vecs && isVoyageConfigured() && args.query.trim()) {
    try {
      const key = args.query.slice(0, 2000);
      q = queryCache.get(key) ?? (await embedOne(key, 'query'));
      queryCache.set(key, q);
      if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value!);
      method = 'embedding';
    } catch (err) {
      logger.warn({ err: (err as Error).message }, 'lecture examples: 임베딩 실패 → 키워드 폴백');
    }
  }
  if (q && vecs) {
    const qq = q;
    score = (i) => cosineAt(vecs, i, qq);
  } else {
    const qb = bigrams(args.query);
    score = (_i, c) => lexical(c, qb);
  }

  const scored = pool.map(({ c, i }) => ({ c, s: score(i, c) }));
  const pick = (arr: typeof scored, k: number, withWeight: boolean) => {
    const out: LectureCase[] = [];
    const seenText = new Set<string>();
    for (const { c } of [...arr].sort((a, b) => b.s + (withWeight ? weight(b.c) : 0) - (a.s + (withWeight ? weight(a.c) : 0)))) {
      const key = c.text.replace(/[\s\W_]+/g, '').slice(0, 20);
      if (seenText.has(key)) continue;
      seenText.add(key);
      out.push(c);
      if (out.length >= k) break;
    }
    return out;
  };
  const good = pick(scored.filter((x) => x.c.verdict !== 'fail'), goodK, true);
  const bad = pick(scored.filter((x) => x.c.verdict === 'fail' && x.c.why), badK, false);
  return { good, bad, method };
}

function line(t: string | null | undefined): string {
  return (t ?? '').replace(/\s*\n\s*/g, ' / ').trim();
}

/** 생성기 프롬프트 블록. */
export function renderLectureExamples(ex: LectureExamples): string {
  const out: string[] = [];
  out.push('== ★★★ 강의 실전 사례 — 이 원본과 비슷한 상황에서 강사·수강생이 실제로 쓴 글 (최우선 본보기) ==');
  out.push(
    '아래 사례의 **첫 줄 틀·구조·말투 리듬**을 이 원본·상품에 맞게 옮겨 써라. 추상 규칙보다 이 실제 글들을 따라라.\n' +
      '- 검증된 첫 줄 틀("~왜 홍보 안함?", "~인 줄 알았더니", "~왜 이제 알았지" 등)은 소재만 바꿔 그대로 써도 된다.\n' +
      '- 사례의 사연·인물·수치는 가져오지 마라(이 원본에 없는 사실 창작 금지). 가져올 것은 "틀"이다.\n' +
      '- 원본의 핵심(브랜드·장면·반전)이 사례 틀의 빈칸에 들어가야 한다. 원본 브랜드가 훅이면 첫 줄에 브랜드.',
  );
  ex.good.forEach((c, i) => {
    const tag = c.verdict === 'fix' ? '강사 수정안' : c.verdict === 'template' ? '강사 템플릿' : '실전 성공';
    out.push(`\n${i + 1}) [${tag} · ${c.lecture_name} ${c.ts}${c.result ? ` · ${c.result}` : ''}]`);
    if (c.verdict === 'fix' && c.original) out.push(`   고치기 전: "${line(c.original)}"`);
    out.push(`   글: "${line(c.text)}"`);
    if (c.why) out.push(`   왜: ${line(c.why)}`);
    if (c.applies_when) out.push(`   맞는 상황: ${line(c.applies_when)}`);
  });
  if (ex.bad.length) {
    out.push('\n⛔ 강의 실패 사례 — 이렇게 쓰지 마라:');
    ex.bad.forEach((c) => out.push(`- "${line(c.text)}" → ${line(c.why)}`));
  }
  out.push(
    '\n출력 JSON에 rationale 도 채워라: situation(원본이 무슨 상황인지 한 줄), point(한국 독자가 반응할 포인트 한 줄), pattern(위 사례 중 몇 번 틀을 어떻게 썼는지 한 줄).',
  );
  return out.join('\n');
}

export interface CopyRationale {
  situation?: string;
  point?: string;
  pattern?: string;
}
