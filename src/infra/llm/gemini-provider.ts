import { GoogleGenAI, type Part } from '@google/genai';
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

    const result = await client.models.generateContent({
      model,
      contents: [{ role: 'user', parts }],
      config: {
        systemInstruction: input.system,
        temperature: input.temperature ?? 0.7,
        maxOutputTokens: input.maxOutputTokens ?? 1024,
        responseMimeType: input.jsonMode ? 'application/json' : 'text/plain',
      },
    });

    const text = result.text ?? '';
    logger.debug(
      { model, inputChars: JSON.stringify(input.userParts).length, outputChars: text.length },
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

async function fetchImageInline(url: string): Promise<{ mimeType: string; data: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch image failed ${resp.status}: ${url}`);
  const contentType = resp.headers.get('content-type') ?? guessMime(url);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { mimeType: contentType, data: buffer.toString('base64') };
}

function guessMime(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  if (u.endsWith('.mp4')) return 'video/mp4';
  return 'image/jpeg';
}
