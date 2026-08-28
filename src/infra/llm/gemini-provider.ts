import { GoogleGenAI, Type, type Part } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from './types.js';

/**
 * Google Gemini provider. gemini-2.5-pro (main) / gemini-2.5-flash (fast).
 * 무료 tier: 15 RPM, 1500 RPD (개발용 충분).
 * Vision·JSON mode 지원. 이미지 URL은 fetch 후 inline base64로 전달.
 */
export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini' as const;
  private client: GoogleGenAI | null = null;

  private ensureClient(): GoogleGenAI {
    if (this.client) return this.client;
    if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
    this.client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
    return this.client;
  }

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const model = input.tier === 'fast' ? env.GEMINI_MODEL_FAST : env.GEMINI_MODEL_MAIN;
    const client = this.ensureClient();

    const parts: Part[] = [];
    for (const p of input.userParts) {
      if (p.type === 'text') {
        parts.push({ text: p.text });
      } else {
        const inline = await fetchImageInline(p.url);
        parts.push({ inlineData: inline });
      }
    }

    const doCall = async () => {
      const config: Record<string, unknown> = {
        systemInstruction: input.system,
        temperature: input.temperature ?? 0.7,
        maxOutputTokens: input.maxOutputTokens ?? 1024,
        // thinking mode 비활성화 — 짧은 카피/판정 응답에 thinking 토큰이 응답 예산 잡아먹음.
        thinkingConfig: { thinkingBudget: 0 },
      };
      if (input.jsonMode) {
        config.responseMimeType = 'application/json';
        if (input.jsonSchema) config.responseSchema = normalizeSchema(input.jsonSchema);
      }
      return client.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        config: config as any,
      });
    };

    const result = await withRetry(doCall, { attempts: 3, model });

    const text = result.text ?? '';
    const finishReason = result.candidates?.[0]?.finishReason;
    logger.info(
      {
        model,
        outputChars: text.length,
        rawTextPreview: text.slice(0, 300),
        finishReason,
        usage: result.usageMetadata,
      },
      'gemini complete',
    );

    return {
      text,
      inputTokens: result.usageMetadata?.promptTokenCount,
      outputTokens: result.usageMetadata?.candidatesTokenCount,
      model,
      provider: 'gemini',
    };
  }
}

async function withRetry<T>(fn: () => Promise<T>, opts: { attempts: number; model: string }): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < opts.attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const rawMsg = err instanceof Error ? err.message : String(err);
      const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
      const msg = `${rawMsg} | ${causeMsg}`;
      // 재시도 가능 여부: 5xx 서버 오류 or 429 rate limit or 네트워크 오류 (fetch failed, timeout)
      const retriable =
        /503|429|500|502|504|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL|fetch failed|Timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(
          msg,
        );
      if (!retriable || i === opts.attempts - 1) throw err;
      const delay = 2000 * Math.pow(2, i); // 2s, 4s, 8s
      logger.warn(
        { err: rawMsg, cause: causeMsg, attempt: i + 1, delay, model: opts.model },
        'gemini transient error, retrying',
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

async function fetchImageInline(url: string): Promise<{ mimeType: string; data: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch image failed ${resp.status}: ${url}`);
  const contentType = resp.headers.get('content-type') ?? guessMime(url);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { mimeType: contentType, data: buffer.toString('base64') };
}

/**
 * 우리 API에서 사용하는 문자열 타입("object", "string" 등)을
 * @google/genai가 요구하는 Type enum 값으로 변환.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  const out = Array.isArray(schema) ? [] : { ...schema };
  if (schema.type && typeof schema.type === 'string') {
    const map: Record<string, Type> = {
      object: Type.OBJECT,
      string: Type.STRING,
      boolean: Type.BOOLEAN,
      number: Type.NUMBER,
      integer: Type.INTEGER,
      array: Type.ARRAY,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).type = map[schema.type.toLowerCase()] ?? schema.type;
  }
  if (schema.properties) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).properties = Object.fromEntries(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Object.entries(schema.properties as Record<string, any>).map(([k, v]) => [k, normalizeSchema(v)]),
    );
  }
  if (schema.items) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (out as any).items = normalizeSchema(schema.items);
  }
  return out;
}

function guessMime(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.mp4')) return 'video/mp4';
  return 'image/jpeg';
}
