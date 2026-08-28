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

  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_MODEL_SONNET: z.string().default('claude-sonnet-5'),
  ANTHROPIC_MODEL_HAIKU: z.string().default('claude-haiku-4-5-20251001'),

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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;
