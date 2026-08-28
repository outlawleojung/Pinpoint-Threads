import { Agent, setGlobalDispatcher } from 'undici';

/**
 * Node의 기본 undici fetch는 headers timeout 60초.
 * Gemini flash 이미지 요청은 60~90초 걸리는 경우 있어 확대.
 */
let installed = false;
export function installHttpDefaults() {
  if (installed) return;
  installed = true;
  setGlobalDispatcher(
    new Agent({
      headersTimeout: 180_000, // 3분
      bodyTimeout: 180_000,
      keepAliveTimeout: 60_000,
      keepAliveMaxTimeout: 300_000,
    }),
  );
}
