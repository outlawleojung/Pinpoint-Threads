import { request } from 'undici';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Apify HTTP 클라이언트 (얇은 래퍼).
 *
 * 두 가지 실행 방식:
 *   - runActorSync: 액터 실행 완료까지 대기 + 데이터셋 아이템 바로 반환
 *     짧은 job(<5분)에 적합. Lane 1 단건 URL fetch에 이상적.
 *   - runActorAsync: 실행 시작 → runId 반환. 이후 폴링 별도.
 *     대량 job에 적합. 필요 시 이후 확장.
 *
 * 액터 ID는 각 어댑터가 env에서 읽어 넘김.
 * APIFY_API_TOKEN 미설정 시 명확한 에러.
 */

const APIFY_API_BASE = 'https://api.apify.com/v2';

export class ApifyNotConfiguredError extends Error {
  constructor() {
    super('APIFY_API_TOKEN 미설정. .env에 apify.com 토큰을 입력하세요.');
    this.name = 'ApifyNotConfiguredError';
  }
}

export class ApifyRunError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly runId?: string,
  ) {
    super(message);
    this.name = 'ApifyRunError';
  }
}

export interface RunActorOptions {
  actorId: string;              // 예: "futurizerush/meta-threads-scraper" 또는 "abc123XYZ"
  input: Record<string, unknown>;
  timeoutSecs?: number;         // 액터 실행 최대 시간 (기본 300s)
  memoryMbytes?: number;        // 액터 메모리 (기본 액터 기본값)
}

export function isApifyConfigured(): boolean {
  return Boolean(env.APIFY_API_TOKEN);
}

function actorPath(actorId: string): string {
  // "user/actor-slug" → "user~actor-slug" (Apify URL 규칙)
  return actorId.replace('/', '~');
}

/**
 * 액터 실행 완료까지 대기 후 데이터셋 아이템 리스트 반환.
 * timeout 초과 시 ApifyRunError. 실패한 run도 에러.
 */
export async function runActorSync<T = unknown>(
  opts: RunActorOptions,
): Promise<T[]> {
  if (!isApifyConfigured()) throw new ApifyNotConfiguredError();

  const path = actorPath(opts.actorId);
  const timeoutSecs = opts.timeoutSecs ?? 300;
  const params = new URLSearchParams({
    token: env.APIFY_API_TOKEN as string,
    timeout: String(timeoutSecs),
    clean: 'true', // 이전 실패 데이터 제외, 성공한 것만
  });
  if (opts.memoryMbytes) params.set('memory', String(opts.memoryMbytes));

  const url = `${APIFY_API_BASE}/acts/${path}/run-sync-get-dataset-items?${params.toString()}`;

  const startedAt = Date.now();
  logger.info({ actorId: opts.actorId, timeoutSecs }, 'apify actor run start (sync)');

  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts.input),
    bodyTimeout: (timeoutSecs + 60) * 1000,
    headersTimeout: (timeoutSecs + 60) * 1000,
  });

  const elapsedMs = Date.now() - startedAt;

  if (res.statusCode >= 400) {
    let bodyText = '';
    try {
      bodyText = await res.body.text();
    } catch {}
    throw new ApifyRunError(
      `Apify actor ${opts.actorId} HTTP ${res.statusCode}: ${bodyText.slice(0, 500)}`,
      res.statusCode,
    );
  }

  const items = (await res.body.json()) as T[];
  logger.info(
    { actorId: opts.actorId, elapsedMs, itemCount: Array.isArray(items) ? items.length : 0 },
    'apify actor run done (sync)',
  );

  if (!Array.isArray(items)) {
    throw new ApifyRunError(
      `Apify actor ${opts.actorId} returned non-array dataset (unexpected shape)`,
    );
  }
  return items;
}

/**
 * 액터 실행 시작만. runId 반환. 폴링·데이터셋 조회는 별도.
 * 장시간 job 또는 백그라운드 실행에 사용.
 */
export interface AsyncRunStartResult {
  runId: string;
  actorId: string;
  status: string;
  defaultDatasetId: string | null;
}

export async function startActorRun(opts: RunActorOptions): Promise<AsyncRunStartResult> {
  if (!isApifyConfigured()) throw new ApifyNotConfiguredError();
  const path = actorPath(opts.actorId);
  const params = new URLSearchParams({ token: env.APIFY_API_TOKEN as string });
  if (opts.timeoutSecs) params.set('timeout', String(opts.timeoutSecs));
  if (opts.memoryMbytes) params.set('memory', String(opts.memoryMbytes));

  const url = `${APIFY_API_BASE}/acts/${path}/runs?${params.toString()}`;
  const res = await request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts.input),
  });
  if (res.statusCode >= 400) {
    const t = await res.body.text();
    throw new ApifyRunError(`start run failed: HTTP ${res.statusCode}: ${t.slice(0, 500)}`);
  }
  const json = (await res.body.json()) as any;
  return {
    runId: json.data.id,
    actorId: opts.actorId,
    status: json.data.status,
    defaultDatasetId: json.data.defaultDatasetId ?? null,
  };
}
