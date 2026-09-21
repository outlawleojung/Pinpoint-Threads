import { ThreadsClient } from '../../../infra/threads-client.js';
import { prisma } from '../../../db/prisma.js';
import { logger } from '../../../config/logger.js';
import { refreshAccountToken } from './oauth/token-service.js';
import { extractUrls, isCommerceUrl } from '../url-ingester/platform-detector.js';
import { env } from '../../../config/env.js';
import { SHARING_TOPIC_TAG } from '../../pipeline-b/sharing-copywriter/index.js';

/** 발행 사고를 관리자 텔레그램으로 즉시 알림 (best-effort · 실패해도 발행 흐름엔 영향 X). */
async function notifyAdmin(message: string): Promise<void> {
  try {
    const { bot } = await import('../approval-gate/bot.js');
    await bot.api.sendMessage(env.TELEGRAM_ADMIN_CHAT_ID, message);
  } catch (err) {
    logger.warn({ err }, 'notifyAdmin failed');
  }
}

/** 본문 텍스트를 발행 멱등 비교용으로 정규화 (공백 정리). */
function normalizeBody(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * 고정 답글에 붙일 이미지 URL 을 고른다 — Threads 가 확실히 fetch 가능한 것 우선.
 * 이미지가 붙으면 쿠팡 링크 OG 프리뷰 카드가 억제된다.
 *   1) 상품 썸네일이 Cloudinary 면 사용 (쿠팡 ads-partners 썸네일은 Threads fetch 실패라 제외)
 *   2) 본문 미디어 중 첫 Cloudinary 이미지
 *   3) Cloudinary 비디오 → 첫 프레임(so_0) jpg 변환
 */
function deriveReplyImage(post: {
  mediaUrls?: string[] | null;
  commerceProduct?: { thumbnailUrl?: string | null } | null;
}): string | undefined {
  const isCloudinary = (u: string) => u.includes('res.cloudinary.com');
  const isVideo = (u: string) => u.includes('/video/upload/') || /\.mp4(?:\?|$)/i.test(u);

  const thumb = post.commerceProduct?.thumbnailUrl ?? undefined;
  if (thumb && isCloudinary(thumb) && !isVideo(thumb)) return thumb;

  const media = post.mediaUrls ?? [];
  const img = media.find((u) => isCloudinary(u) && !isVideo(u));
  if (img) return img;

  const vid = media.find((u) => isCloudinary(u) && isVideo(u));
  if (vid) {
    return vid
      .replace('/video/upload/', '/video/upload/so_0/')
      .replace(/\.mp4(?=\?|$)/i, '.jpg');
  }
  return undefined;
}

/**
 * Publisher — 2-step 발행 오케스트레이션.
 *
 * 흐름:
 *   1) Account 검증 (활성 · 토큰 유효)
 *   2) 만료 임박 시 자동 refresh
 *   3) 본문 + 미디어(carousel 포함) 발행 → threadsPostId
 *   4) 고정 댓글 발행 → threadsReplyId
 *   5) Post 레코드 상태 전이 (APPROVED → PUBLISHING → PUBLISHED / FAILED)
 */

const client = new ThreadsClient();

const REFRESH_IF_EXPIRES_WITHIN_MS = 7 * 24 * 60 * 60 * 1000; // 7일

export interface PublishInput {
  postId: string;
}

export interface PublishResult {
  postId: string;
  threadsPostId: string;
  threadsReplyId: string | null;
  publishedAt: Date;
}

export class PublisherError extends Error {
  constructor(
    message: string,
    public readonly code: 'ACCOUNT_INACTIVE' | 'TOKEN_MISSING' | 'INVALID_STATE' | 'API_ERROR',
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'PublisherError';
  }
}

export async function publish(input: PublishInput): Promise<PublishResult> {
  const post = await prisma.post.findUnique({
    where: { id: input.postId },
    include: { account: true, commerceProduct: true },
  });

  if (!post) throw new PublisherError(`Post ${input.postId} not found`, 'INVALID_STATE');
  // PUBLISHING 도 허용: 이전 시도가 스톨(워커 재기동 등)로 PUBLISHING 에 갇힌 경우 복구.
  // 중복 발행은 아래 멱등 프리체크로 방지.
  if (post.state !== 'APPROVED' && post.state !== 'FAILED' && post.state !== 'PUBLISHING') {
    throw new PublisherError(
      `Post ${input.postId} state is ${post.state}, expected APPROVED/FAILED/PUBLISHING`,
      'INVALID_STATE',
    );
  }
  // 복구 상황(이전에 발행 시도한 흔적) 여부 → 멱등 프리체크 대상
  const isRecovery = post.state === 'PUBLISHING' || post.state === 'FAILED';
  if (!post.generatedBody) {
    throw new PublisherError(`Post ${input.postId} has no generatedBody`, 'INVALID_STATE');
  }
  // 하드룰: 본문에 커머스 링크(쿠팡·무신사·네이버) 절대 금지 (계정 밴 트리거).
  // 프롬프트로만 막던 것을 발행 직전 결정적으로 차단 → 발견 시 FAILED + 알림 (사람이 재생성).
  const bodyCommerceUrls = extractUrls(post.generatedBody).filter((u) => isCommerceUrl(u));
  if (bodyCommerceUrls.length > 0) {
    await prisma.post.update({
      where: { id: post.id },
      data: { state: 'FAILED', rejectionReason: `본문에 커머스 링크 포함(차단): ${bodyCommerceUrls[0]}` },
    }).catch(() => {});
    await notifyAdmin(
      `⛔ 발행 차단: 본문에 커머스 링크가 있습니다 (계정 밴 위험).\n` +
      `계정: ${post.account.handle}\nPost: ${post.id}\n링크: ${bodyCommerceUrls[0]}\n` +
      `→ 텍스트 재생성 후 다시 승인하세요.`,
    );
    throw new PublisherError('본문에 커머스 링크 포함 — 발행 차단', 'INVALID_STATE');
  }
  if (!post.account.isActive) {
    throw new PublisherError(
      `Account ${post.account.handle} is inactive`,
      'ACCOUNT_INACTIVE',
    );
  }
  if (!post.account.accessToken || !post.account.tokenExpiresAt) {
    throw new PublisherError(
      `Account ${post.account.handle} has no valid token`,
      'TOKEN_MISSING',
    );
  }

  let accessToken = post.account.accessToken;
  const msUntilExpiry = post.account.tokenExpiresAt.getTime() - Date.now();
  if (msUntilExpiry < REFRESH_IF_EXPIRES_WITHIN_MS) {
    try {
      const refreshed = await refreshAccountToken(post.account.id);
      const reread = await prisma.account.findUnique({ where: { id: post.account.id } });
      accessToken = reread!.accessToken;
      logger.info({ handle: post.account.handle, newExpiry: refreshed.expiresAt }, 'pre-publish refresh');
    } catch (err) {
      logger.warn({ err, handle: post.account.handle }, 'pre-publish refresh failed, using existing token');
    }
  }

  await prisma.post.update({
    where: { id: post.id },
    data: { state: 'PUBLISHING' },
  });

  let threadsPostId: string;
  let threadsReplyId: string | null = null;
  try {
    const bodyNorm = normalizeBody(post.generatedBody);
    // 멱등 프리체크(복구 시): 스톨·재시도로 이미 본문이 게시됐을 수 있음 → 재발행 대신 그 id 채택 (중복 방지).
    let preId: string | null = null;
    if (isRecovery) {
      try {
        const recent = await client.fetchRecentPosts(accessToken, 5);
        const hit = recent.find((p) => {
          const t = normalizeBody(p.text);
          const fresh = !p.timestamp || Date.now() - p.timestamp.getTime() < 30 * 60 * 1000;
          return fresh && (t === bodyNorm || (bodyNorm.length >= 15 && t.startsWith(bodyNorm.slice(0, 15))));
        });
        if (hit) {
          preId = hit.id;
          logger.warn({ postId: post.id, threadsPostId: preId }, '멱등 프리체크: 본문 이미 게시됨 → 재발행 스킵, 고정댓글만 진행');
        }
      } catch (err) {
        logger.warn({ err, postId: post.id }, '멱등 프리체크 실패 · 정상 발행 진행');
      }
    }

    // 본문 발행: Threads 비디오 컨테이너가 일시적 "ERROR: UNKNOWN" 반환하는 경우 있음 → 자동 재시도.
    const mainHasVideo = (post.mediaUrls ?? []).some(
      (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'),
    );
    const mainMaxAttempts = mainHasVideo ? 3 : 2;
    let main: { threadsPostId: string } | null = preId ? { threadsPostId: preId } : null;
    let mainErr: unknown = null;
    for (let attempt = 1; !main && attempt <= mainMaxAttempts; attempt++) {
      try {
        main = await client.publish({
          accessToken,
          text: post.generatedBody,
          mediaUrls: post.mediaUrls ?? [],
          // 스하리 글: "스하리1000명프로젝트"를 본문 텍스트가 아니라 topic_tag 로만 부착 (본문엔 안 보임).
          topicTag: post.kind === 'SHARING' ? SHARING_TOPIC_TAG : undefined,
        });
        mainErr = null;
        break;
      } catch (err) {
        mainErr = err;
        logger.warn({ err, postId: post.id, attempt, mainMaxAttempts }, 'main publish attempt failed, retrying');
        // 멱등 확인: 이번 시도가 실제로는 게시됐는데 응답 읽기 실패로 throw 됐을 수 있음.
        // 재시도로 중복 게시물이 생기는 것을 방지 — 최근 게시글에서 같은 본문을 찾으면 그 id 채택.
        try {
          const recent = await client.fetchRecentPosts(accessToken, 5);
          const hit = recent.find((p) => {
            const t = normalizeBody(p.text);
            const fresh = !p.timestamp || Date.now() - p.timestamp.getTime() < 10 * 60 * 1000;
            return fresh && (t === bodyNorm || (bodyNorm.length >= 15 && t.startsWith(bodyNorm.slice(0, 15))));
          });
          if (hit) {
            logger.warn({ postId: post.id, threadsPostId: hit.id }, 'idempotency: 이미 게시됨 감지 → 중복 방지, 기존 id 사용');
            main = { threadsPostId: hit.id };
            mainErr = null;
            break;
          }
        } catch (checkErr) {
          logger.warn({ checkErr, postId: post.id }, 'idempotency 확인 실패 · 재시도 진행');
        }
        if (attempt < mainMaxAttempts) {
          await new Promise((r) => setTimeout(r, 15_000 * attempt)); // 15s · 30s 백오프
        }
      }
    }
    if (!main) throw mainErr ?? new Error('main publish failed');
    threadsPostId = main.threadsPostId;
    logger.info({ postId: post.id, threadsPostId, handle: post.account.handle }, 'main post published');

    if (post.generatedReply) {
      // 비디오 포함 게시글은 Meta 후단 처리가 이어지므로 reply 전 대기 필요.
      // 이미지만이면 즉시 reply 가능.
      const hasVideo = (post.mediaUrls ?? []).some(
        (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'),
      );
      const replyDelayMs = hasVideo ? 30_000 : 1_000;

      // 재시도 로직: reply 실패 시 지수 백오프 (비디오 후단 처리 대기 · 최대 총 ~3분)
      // 비영상도 5회까지(이미지 4회 + 텍스트 1회): 이미지 컨테이너가 첫 시도에 "media not found"로
      //   실패했다 재시도에서 살아나는 일시 오류가 잦음(2026-09-21 실측 · 최초 발행 3회 전부 실패 사고). 여유를 준다.
      const maxAttempts = hasVideo ? 6 : 5;
      let lastErr: unknown = null;
      // 답글에 이미지를 첨부하면 미디어 슬롯이 채워져 쿠팡 링크 자동 OG 프리뷰 카드가 억제된다.
      //   (ZWS URL 마스킹은 실제로 안 먹히고 링크만 깨진다 — API 엔 프리뷰 끄는 파라미터 없음.)
      //   쿠팡 파트너스 썸네일(ads-partners.coupang.com)은 Threads 가 못 가져와(WEBPAGE_CURL_FAILED) 리플이 통째로 실패하므로,
      //   Threads 가 항상 fetch 가능한 우리 Cloudinary 미디어 프레임을 우선 사용한다.
      //   그래도 실패하면 텍스트 전용으로 폴백(이 경우에만 프리뷰가 뜰 수 있음 · 드묾).
      const replyImageUrl: string | undefined = deriveReplyImage(post);
      // ★ 이미지를 최대한 유지한다(이미지=프리뷰 억제). 한 번 실패했다고 바로 텍스트로 떨어뜨리면
      //   일시적 오류에도 영구 텍스트 폴백 → OG 프리뷰가 뜬다(실측 MUJI 사고). 이미지로 여러 번 재시도하고,
      //   **마지막 몇 시도에서만** 텍스트로 폴백(리플 자체는 반드시 나가게).
      const imageMaxAttempt = replyImageUrl ? Math.min(maxAttempts - 1, 4) : 0;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const wait = attempt === 1 ? replyDelayMs : replyDelayMs * attempt;
        const useImage = attempt <= imageMaxAttempt ? replyImageUrl : undefined;
        logger.info({ postId: post.id, attempt, waitMs: wait, hasVideo, withImage: Boolean(useImage) }, 'waiting before pinned reply');
        await new Promise((r) => setTimeout(r, wait));
        try {
          const reply = await client.reply({
            accessToken,
            parentId: threadsPostId,
            text: post.generatedReply,
            imageUrl: useImage,
          });
          threadsReplyId = reply.threadsReplyId;
          logger.info({ postId: post.id, threadsReplyId, attempt, withImage: Boolean(useImage) }, 'pinned reply published');
          if (!useImage) {
            logger.warn({ postId: post.id }, '고정댓글이 텍스트로 발행됨 → OG 프리뷰가 뜰 수 있음(이미지 첨부 계속 실패)');
          }
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          logger.warn({ err, postId: post.id, attempt, maxAttempts, triedImage: Boolean(useImage) }, 'pinned reply attempt failed, retrying');
        }
      }
      if (lastErr) {
        const reason = String((lastErr as Error)?.message ?? lastErr).slice(0, 500);
        logger.error({ err: lastErr, postId: post.id, threadsPostId }, 'pinned reply failed after retries — main post is live but reply missing');
        await prisma.post.update({
          where: { id: post.id },
          data: { replyFailureReason: reason },
        }).catch(() => {});
        // 고정댓글엔 딥링크 + 공정위 필수 문구가 들어감 → 누락 시 법적·수익 문제.
        // 조용히 PUBLISHED 로 넘기지 말고 관리자에게 즉시 알림 (수동 조치 유도).
        await notifyAdmin(
          `⚠️ 본문은 발행됐으나 고정댓글 발행 실패 (딥링크·공정위 문구 누락).\n` +
          `계정: ${post.account.handle}\nPost: ${post.id}\nThreads: ${threadsPostId}\n사유: ${reason}\n` +
          `→ Threads 앱에서 고정댓글 수동 작성하거나 게시물 삭제 후 재발행하세요.`,
        );
      }
    }
  } catch (err) {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        state: 'FAILED',
        rejectionReason: String((err as Error)?.message ?? err),
        retryCount: { increment: 1 },
      },
    });
    logger.error({ err, postId: post.id }, 'publish failed');
    throw new PublisherError('Threads publish failed', 'API_ERROR', err);
  }

  const publishedAt = new Date();
  // 본문은 이미 라이브 → 이 DB 기록이 실패해도 PUBLISHING 에 갇히지 않게 방어.
  try {
    await prisma.post.update({
      where: { id: post.id },
      data: {
        state: 'PUBLISHED',
        publishedAt,
        threadsPostId,
        threadsReplyId,
      },
    });
  } catch (err) {
    logger.error({ err, postId: post.id, threadsPostId }, 'PUBLISHED 상태 기록 실패 — 게시물은 라이브');
    await notifyAdmin(
      `⚠️ 게시물은 발행됐으나 DB 상태 기록 실패 (수동 확인 필요).\nPost: ${post.id}\nThreads: ${threadsPostId}`,
    );
  }

  return { postId: post.id, threadsPostId, threadsReplyId, publishedAt };
}
