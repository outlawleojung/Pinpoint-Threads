import { GoogleGenAI } from '@google/genai';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

let client: GoogleGenAI | null = null;
function ensureClient(): GoogleGenAI {
  if (client) return client;
  if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');
  client = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  return client;
}

export async function generateImage(prompt: string): Promise<{ mimeType: string; data: Buffer }> {
  const model = env.GEMINI_MODEL_IMAGE;
  const c = ensureClient();
  const result = await c.models.generateContent({
    model,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });
  const parts = result.candidates?.[0]?.content?.parts ?? [];
  for (const p of parts) {
    const inline = p.inlineData;
    if (inline?.data) {
      logger.info({ model, mimeType: inline.mimeType }, 'gemini image generated');
      return { mimeType: inline.mimeType ?? 'image/png', data: Buffer.from(inline.data, 'base64') };
    }
  }
  throw new Error('gemini image: 응답에 inlineData 없음 — 모델명(GEMINI_MODEL_IMAGE) 확인');
}
