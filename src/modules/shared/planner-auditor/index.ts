import { logger } from '../../../config/logger.js';

/**
 * Planner / Auditor.
 * - Daily Planner: 매일 06:00 계정별 A/B/C 슬롯 계산, BullMQ delayed job 예약
 * - Safety Auditor: CIB 감지 신호 실시간 모니터링 (동일 URL, 시간대 몰림, 유사도, rate limit, 정지 감지)
 *
 * TODO(Phase 4d): 실 구현. 지금은 placeholder.
 * 자세한 규칙: docs/09-agents/shared/planner-auditor.md
 */

export async function planToday(_accountId: string): Promise<void> {
  logger.warn({ accountId: _accountId }, 'planner-auditor not implemented (Phase 4d)');
}

export interface SafetySignal {
  kind: 'duplicate-url' | 'timing-cluster' | 'content-similarity' | 'reciprocation-cap-near' | 'rate-limit-near' | 'account-suspended';
  severity: 'INFO' | 'WARN' | 'CRITICAL';
  message: string;
  context?: Record<string, unknown>;
}

export function emitSafetySignal(signal: SafetySignal): void {
  logger[signal.severity === 'INFO' ? 'info' : signal.severity === 'WARN' ? 'warn' : 'error'](
    signal,
    'safety-auditor signal',
  );
  // TODO(Phase 4d): CRITICAL 신호는 Telegram 알림
}
