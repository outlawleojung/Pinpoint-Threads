import { request } from 'undici';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Voyage AI Embedding 클라이언트.
 *
 * Model: voyage-3 (1024 dims, 최상위 · 다국어 지원)
 * Endpoint: POST https://api.voyageai.com/v1/embeddings
 *
 * input_type:
 *   - "document": 저장·인덱싱 대상 (벤치마크 게시글)
 *   - "query": 검색 쿼리 (새 인바운드 원문)
 */

const VOYAGE_API_URL = 'https://api.voyageai.com/v1/embeddings';

export const VOYAGE_DIM = 1024; // voyage-3 · voyage-3-large 기준

export class VoyageNotConfiguredError extends Error {
  constructor() {
    super('VOYAGE_API_KEY 미설정. .env에 dash.voyageai.com 토큰 입력.');
    this.name = 'VoyageNotConfiguredError';
  }
}

export class VoyageApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'VoyageApiError';
  }
}

export function isVoyageConfigured(): boolean {
  return Boolean(env.VOYAGE_API_KEY);
}

export interface EmbedInput {
  texts: string[];
  inputType: 'document' | 'query';
  model?: string;
}

export interface EmbedResult {
  embeddings: number[][];
  totalTokens: number;
}

/**
 * 배치 임베딩. Voyage는 요청당 최대 128개 문서 지원 (모델별 상이).
 * 긴 텍스트는 model context (32000 tokens) 내에서 잘라 넣음.
 */
export async function embed(input: EmbedInput): Promise<EmbedResult> {
  if (!isVoyageConfigured()) throw new VoyageNotConfiguredError();

  const model = input.model ?? env.VOYAGE_MODEL;
  const body = {
    input: input.texts,
    model,
    input_type: input.inputType,
  };

  const res = await request(VOYAGE_API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.VOYAGE_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const json = (await res.body.json()) as any;
  if (res.statusCode >= 400) {
    throw new VoyageApiError(
      `Voyage HTTP ${res.statusCode}: ${JSON.stringify(json).slice(0, 300)}`,
      res.statusCode,
    );
  }

  const embeddings: number[][] = (json.data ?? []).map((d: any) => d.embedding);
  const totalTokens: number = json.usage?.total_tokens ?? 0;

  logger.debug(
    { count: embeddings.length, model, tokens: totalTokens, dim: embeddings[0]?.length },
    'voyage embed done',
  );
  return { embeddings, totalTokens };
}

export async function embedOne(text: string, inputType: 'document' | 'query' = 'document'): Promise<number[]> {
  const { embeddings } = await embed({ texts: [text], inputType });
  if (!embeddings[0]) throw new VoyageApiError('empty embedding response');
  return embeddings[0];
}
