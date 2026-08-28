import Anthropic from '@anthropic-ai/sdk';
import { env } from '../config/env.js';

export const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

export const MODELS = {
  SONNET: env.ANTHROPIC_MODEL_SONNET,
  HAIKU: env.ANTHROPIC_MODEL_HAIKU,
} as const;
