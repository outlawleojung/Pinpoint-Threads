import { env } from '../../config/env.js';
import type { LlmProvider } from './types.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GeminiProvider } from './gemini-provider.js';

let cached: LlmProvider | null = null;

/**
 * env.LLM_PROVIDER 에 따라 활성 프로바이더 반환.
 * 크레딧·구독 상황에 따라 나중에 재전환 자유로움.
 */
export function llm(): LlmProvider {
  if (cached) return cached;
  cached = env.LLM_PROVIDER === 'anthropic' ? new AnthropicProvider() : new GeminiProvider();
  return cached;
}

export type * from './types.js';
