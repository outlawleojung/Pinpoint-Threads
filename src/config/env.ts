import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  APP_PORT: z.coerce.number().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  LLM_PROVIDER: z.enum(['anthropic', 'gemini']).default('gemini'),

  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL_SONNET: z.string().default('claude-sonnet-5'),
  ANTHROPIC_MODEL_HAIKU: z.string().default('claude-haiku-4-5-20251001'),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL_MAIN: z.string().default('gemini-3.6-flash'),
  GEMINI_MODEL_FAST: z.string().default('gemini-3.6-flash'),

  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_REDIRECT_URI: z.string().url().optional(),

  COUPANG_ACCESS_KEY: z.string().optional(),
  COUPANG_SECRET_KEY: z.string().optional(),

  MUSINSA_API_KEY: z.string().optional(),
  MUSINSA_PARTNER_ID: z.string().optional(),

  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_ADMIN_CHAT_ID: z.string().min(1),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('pinpoint-threads'),

  ENGAGEMENT_DAILY_LIMIT: z.coerce.number().default(3),
  ENGAGEMENT_MIN_DELAY_MINUTES: z.coerce.number().default(10),
  ENGAGEMENT_MAX_DELAY_MINUTES: z.coerce.number().default(30),

  PUBLISH_ACCOUNT_MIN_GAP_MINUTES: z.coerce.number().default(60),
  PUBLISH_ACCOUNT_MAX_GAP_MINUTES: z.coerce.number().default(240),
  PRODUCT_DEDUP_DAYS: z.coerce.number().default(14),

  // InboundLink → BenchmarkPost 자동 승격 임계값 (likes 이상 시 자동 승격, 스레드 기준)
  BENCHMARK_AUTO_PROMOTE_MIN_LIKES: z.coerce.number().default(500),

  NAVER_CLIENT_ID: z.string().optional(),
  NAVER_CLIENT_SECRET: z.string().optional(),

  APIFY_API_TOKEN: z.string().optional(),
  APIFY_ACTOR_ID: z.string().optional(), // (deprecated, 어댑터별 개별 지정으로 이관)
  APIFY_ACTOR_XHS_URL: z.string().optional(),     // 샤오홍슈 단건 URL 파싱
  APIFY_ACTOR_XHS_KEYWORD: z.string().optional(), // 샤오홍슈 키워드 검색
  APIFY_ACTOR_TIKTOK_KEYWORD: z.string().optional(),
  APIFY_ACTOR_IG_KEYWORD: z.string().optional(),
  APIFY_ACTOR_THREADS_KEYWORD: z.string().optional(),
  APIFY_ACTOR_TIKTOK_CC: z.string().optional(),

  VOYAGE_API_KEY: z.string().optional(),
  VOYAGE_MODEL: z.string().default('voyage-3'),

  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().default('CHANGE_ME_TO_32_PLUS_CHAR_RANDOM_SECRET_LOCAL_DEV_ONLY_XYZ'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;

if (env.SESSION_SECRET.length < 32) {
  console.warn(
    `⚠️ SESSION_SECRET too short (${env.SESSION_SECRET.length} chars, need 32+). 세션 위조 리스크. .env 재설정 권장.`,
  );
}
