import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../../config/env.js';

/**
 * 세션 헬퍼 — HMAC-SHA256 서명된 쿠키 (stateless).
 *
 * 쿠키 값: base64url(payload).base64url(signature)
 * payload = JSON { u: userId, n: username, exp: epochSec }
 *
 * 서버 재시작해도 쿠키 유효 (SESSION_SECRET 유지되는 한).
 * SESSION_SECRET 재발급 시 모든 세션 무효화.
 */

export const SESSION_COOKIE_NAME = 'pt_admin_session';
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24h

export interface SessionPayload {
  u: string;   // userId
  n: string;   // username
  exp: number; // epoch seconds
}

export function issueSession(input: { userId: string; username: string }): {
  value: string;
  maxAge: number;
} {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    u: input.userId,
    n: input.username,
    exp: now + SESSION_TTL_SECONDS,
  };
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = signPayload(payloadB64);
  return { value: `${payloadB64}.${sig}`, maxAge: SESSION_TTL_SECONDS };
}

export function verifySession(cookieValue: string | undefined): SessionPayload | null {
  if (!cookieValue) return null;
  const dot = cookieValue.indexOf('.');
  if (dot <= 0) return null;
  const payloadB64 = cookieValue.slice(0, dot);
  const sig = cookieValue.slice(dot + 1);

  const expectedSig = signPayload(payloadB64);
  if (sig.length !== expectedSig.length) return null;
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  let payload: SessionPayload;
  try {
    const raw = Buffer.from(base64UrlDecode(payloadB64)).toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof payload?.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  if (typeof payload.u !== 'string' || typeof payload.n !== 'string') return null;
  return payload;
}

function signPayload(payloadB64: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(payloadB64).digest('base64url');
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad);
  return Buffer.from(b64, 'base64');
}
