import { env } from '../../../config/env.js';
import { logger } from '../../../config/logger.js';
import { buildInfoPost } from '../info-post/index.js';
import { sendDigestMessage } from '../../shared/approval-gate/notifier.js';

/**
 * Pipeline D 일일 정보글(INFO) 잡.
 * 하루 1회 INFO 포스트 생성 + 관리자에게 텔레그램 알림(발행 페이지 URL).
 * 텔레그램 알림 실패는 잡 실패로 취급하지 않는다(글 생성이 핵심).
 */
export async function runDailyInfoJob(): Promise<{ naverPostId: string; title: string; category: string }> {
  const out = await buildInfoPost();
  const pageUrl = `http://localhost:${env.APP_PORT}/admin/naver/${out.naverPostId}`;

  try {
    await sendDigestMessage(
      `🟢 오늘의 정보글 초안 준비됨\n[${out.category}] ${out.title}\n발행 페이지: ${pageUrl}\n(복붙 발행하세요)`,
    );
  } catch (err) {
    logger.warn({ err, naverPostId: out.naverPostId }, '텔레그램 알림 실패 (글 생성은 성공)');
  }

  logger.info({ naverPostId: out.naverPostId, category: out.category }, 'daily info job done');
  return out;
}
