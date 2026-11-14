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
  // 하드룰: SHOPPING 글은 고정댓글(딥링크+공정위 문구)이 반드시 있어야 발행.
  // generatedReply 가 없으면 링크 없이 나가는 사고 → 차단 후 알림 (2026-10-30).
  if (post.kind === 'SHOPPING' && !post.generatedReply) {
    await prisma.post.update({
      where: { id: post.id },
      data: { state: 'FAILED', rejectionReason: '고정댓글(딥링크+공정위 문구) 없음 — 쇼핑 글 발행 차단' },
    });
    await notifyAdmin(
      `⛔ 쇼핑 글 발행 차단: 고정댓글(딥링크+공정위 문구)이 없습니다.\n` +
      `계정: ${post.account.handle}\nPost: ${post.id}\n` +
      `→ 커머스 링크를 포함해서 다시 생성하세요.`,
    );
    throw new PublisherError('SHOPPING 글에 generatedReply 없음 — 발행 차단', 'INVALID_STATE');
  }

  // 쉬는 계정이라도 회복 확인용으로 명시 허용된 글(sourceBrief.allowInactive)은 발행 (2026-10-01 _blanchatt_ 테스트)
  const allowInactive = Boolean((post.sourceBrief as { allowInactive?: boolean } | null)?.allowInactive);
  if (!post.account.isActive && !allowInactive) {
    throw new PublisherError(
      `Account ${post.account.handle} is inactive`,
      'ACCOUNT_INACTIVE',
    );
  }
  // 안전망: 스하리 연속 금지 — 직전에 실제 나간 글이 스하리면 발행 안 하고 카드 상태로 되돌림 (2026-10-04)
  if (post.kind === 'SHARING') {
    const { consecutiveSharingBlock } = await import('./scheduler.js');
    const block = await consecutiveSharingBlock(post.accountId, { excludePostId: post.id, includeQueued: false });
    if (block) {
      await prisma.post.update({ where: { id: post.id }, data: { state: 'PENDING_APPROVAL', scheduledAt: null } }).catch(() => {});
      await notifyAdmin(`⏸ 스하리 발행 보류 (${post.account.handle}): ${block}.\nPost: ${post.id} — 일상글이 나간 뒤 카드에서 다시 승인하세요.`);
      throw new PublisherError(`consecutive sharing blocked: ${block}`, 'INVALID_STATE');
    }
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

  // 안전망: 팔로워 300 미만 계정의 쇼핑 글은 링크(고정댓글) 없이 일상글로 발행.
  //   강의 11개 공통 최강 금지 + 사용자 결정(2026-09-30). 계정 선택 단계(isShoppingEligible)에서도 막지만,
  //   수동 지정·재탕 등 어떤 경로로 들어와도 여기서 최종 차단한다.
  //   + 링크 비율 상한(최근 5개 중 1개 · 2026-10-02 링크 과다 계정 도달 붕괴): 넘으면 같은 방식으로 링크 생략.
  const { LINK_MIN_FOLLOWERS, linkRatioBlock, SHOPPING_OVERRIDE_HANDLES } = await import('../../pipeline-a/reach-health.js');
  const ratioBlock = post.kind === 'SHOPPING' ? await linkRatioBlock(post.accountId, post.id) : null;
  const isOverride = SHOPPING_OVERRIDE_HANDLES.has(post.account.handle);
  const stripReason =
    post.kind !== 'SHOPPING'
      ? null
      : !isOverride && (post.account.followersCount ?? 0) < LINK_MIN_FOLLOWERS
        ? `팔로워 ${post.account.followersCount ?? 0}명 < ${LINK_MIN_FOLLOWERS} → 링크 생략(일상글 강등)`
        : ratioBlock
          ? `${ratioBlock} → 링크 생략(일상글 강등)`
          : null;
  if (stripReason != null) {
    // 쇼핑 글인데 링크를 뺄 수밖에 없으면 발행하지 않고 보류 (2026-10-30 사용자: "댓글 링크 없으면 발행하면 안 되지")
    await prisma.post.update({
      where: { id: post.id },
      data: { state: 'PENDING_APPROVAL', scheduledAt: null, replyFailureReason: stripReason },
    });
    await notifyAdmin(
      `⏸ 쇼핑 글 발행 보류: ${stripReason}\n` +
      `계정: ${post.account.handle}\nPost: ${post.id}\n` +
      `→ 일상글을 더 발행한 뒤 카드에서 다시 승인하세요.`,
    );
    throw new PublisherError(`쇼핑 글 링크 금지 조건 → 발행 보류: ${stripReason}`, 'INVALID_STATE');
  }

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
      const hasVideo = (post.mediaUrls ?? []).some(
        (u: string) => /\.mp4(?:\?|$)/i.test(u) || u.includes('/video/upload/'),
      );
      // Threads 내부 미디어 인덱싱 지연: 이미지도 5~15초 걸릴 수 있음 (실측 11% 실패율).
      const replyDelayMs = hasVideo ? 30_000 : 5_000;

      const maxAttempts = hasVideo ? 5 : 4;
      let lastErr: unknown = null;
      const replyImageUrl: string | undefined = deriveReplyImage(post);
      // 이미지 1번 시도 → 실패하면 바로 텍스트 전용으로 전환. 댓글 자체(딥링크+공정위)가 나가는 게 최우선.
      const imageMaxAttempt = replyImageUrl ? 1 : 0;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        // 지수 백오프: 이미지 5s→10s→20s→40s→80s (총 ~155s), 비디오 30s→60s→… (총 ~6분)
        const wait = attempt === 1 ? replyDelayMs : replyDelayMs * Math.pow(2, attempt - 2);
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

        // 쇼핑 글: 고정댓글(딥링크+공정위 문구)이 없으면 발행 자체가 무의미 → 본문 삭제 + FAILED.
        if (post.kind === 'SHOPPING') {
          try {
            await client.deletePost(accessToken, threadsPostId);
            logger.info({ postId: post.id, threadsPostId }, '쇼핑 글 고정댓글 실패 → 본문 삭제 완료');
          } catch (delErr) {
            logger.error({ err: delErr, postId: post.id, threadsPostId }, '본문 삭제도 실패 — 수동 삭제 필요');
          }
          await prisma.post.update({
            where: { id: post.id },
            data: { state: 'FAILED', replyFailureReason: reason, threadsPostId: null, threadsReplyId: null },
          }).catch(() => {});
          await notifyAdmin(
            `⛔ 쇼핑 글 고정댓글 실패 → 본문도 삭제함 (FAILED 처리).\n` +
            `계정: ${post.account.handle}\nPost: ${post.id}\n사유: ${reason}\n` +
            `→ 카드에서 다시 승인하면 재발행됩니다.`,
          );
          throw new PublisherError(`쇼핑 글 고정댓글 실패 → 본문 삭제 + FAILED`, 'API_ERROR', lastErr);
        }

        // 비쇼핑 글(일상·스하리): 고정댓글 없어도 본문은 유지 + 알림만.
        await prisma.post.update({
          where: { id: post.id },
          data: { replyFailureReason: reason },
        }).catch(() => {});
        await notifyAdmin(
          `⚠️ 본문은 발행됐으나 고정댓글 발행 실패.\n` +
          `계정: ${post.account.handle}\nPost: ${post.id}\nThreads: ${threadsPostId}\n사유: ${reason}\n` +
          `→ Threads 앱에서 고정댓글 수동 작성하세요.`,
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
