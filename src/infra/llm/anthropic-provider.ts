import { anthropic, MODELS } from '../anthropic-client.js';
import { logger } from '../../config/logger.js';
import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from './types.js';

/**
 * Anthropic Claude provider. Sonnet (main) / Haiku (fast).
 * env.LLM_PROVIDER=anthropic 일 때 사용.
 *
 * 이미지는 URL 직접 전달이 아닌 base64 inline 방식.
 * Anthropic이 URL fetch 시 robots.txt를 존중하는데, picsum/coupang 등 일부 호스트가
 * 봇을 차단해 400 반환. 우리가 직접 fetch하면 이 문제 회피.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const model = input.tier === 'fast' ? MODELS.HAIKU : MODELS.SONNET;

    type UserContent = Array<
      | { type: 'text'; text: string }
      | {
          type: 'image';
          source: { type: 'base64'; media_type: string; data: string };
        }
    >;

    const content: UserContent = [];
    for (const p of input.userParts) {
      if (p.type === 'text') {
        content.push({ type: 'text', text: p.text });
      } else {
        const inline = await fetchImageBase64(p.url);
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: inline.mediaType, data: inline.data },
        });
      }
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens: input.maxOutputTokens ?? 1024,
      system: input.system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    });

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('no text block in anthropic response');

    logger.debug(
      { model, inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      'anthropic complete',
    );

    return {
      text: block.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
      provider: 'anthropic',
    };
  }
}

async function fetchImageBase64(url: string): Promise<{ mediaType: string; data: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`fetch image failed ${resp.status}: ${url}`);
  const rawContentType = resp.headers.get('content-type') ?? '';
  const mediaType = rawContentType.startsWith('image/') ? rawContentType.split(';')[0]!.trim() : guessMime(url);
  const buffer = Buffer.from(await resp.arrayBuffer());
  return { mediaType, data: buffer.toString('base64') };
}

function guessMime(url: string): string {
  const u = url.toLowerCase();
  if (u.endsWith('.png')) return 'image/png';
  if (u.endsWith('.webp')) return 'image/webp';
  if (u.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
