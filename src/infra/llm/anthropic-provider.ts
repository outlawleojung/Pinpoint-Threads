import type Anthropic from '@anthropic-ai/sdk';
import { anthropic, MODELS } from '../anthropic-client.js';
import { logger } from '../../config/logger.js';
import type { LlmCompletionInput, LlmCompletionResult, LlmProvider } from './types.js';

/**
 * Anthropic Claude provider. Sonnet (main) / Haiku (fast).
 * env.LLM_PROVIDER=anthropic 일 때 사용.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;

  async complete(input: LlmCompletionInput): Promise<LlmCompletionResult> {
    const model = input.tier === 'fast' ? MODELS.HAIKU : MODELS.SONNET;

    type UserContent = Array<
      | { type: 'text'; text: string }
      | { type: 'image'; source: { type: 'url'; url: string } }
    >;
    const content: UserContent = input.userParts.map((p) =>
      p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image', source: { type: 'url', url: p.url } },
    );

    const response = await anthropic.messages.create({
      model,
      max_tokens: input.maxOutputTokens ?? 1024,
      system: input.system,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: content as any }],
    });

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') throw new Error('no text block in anthropic response');

    logger.debug({ model, inputTokens: response.usage.input_tokens }, 'anthropic complete');

    return {
      text: block.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
      provider: 'anthropic',
    };
  }
}
