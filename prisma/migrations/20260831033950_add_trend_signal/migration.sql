-- CreateEnum
CREATE TYPE "TrendSource" AS ENUM ('NAVER_DATALAB', 'GOOGLE_TRENDS', 'TIKTOK_CREATIVE_CENTER', 'COUPANG_RANKING', 'MUSINSA_RANKING', 'XIAOHONGSHU_DISCOVER', 'INSTAGRAM_REELS', 'MANUAL');

-- CreateEnum
CREATE TYPE "TrendCategory" AS ENUM ('BEAUTY_SKINCARE', 'BEAUTY_MAKEUP', 'FASHION', 'HOME', 'KITCHEN', 'BABY_KIDS', 'HEALTH', 'FOOD', 'TECH', 'MONEY', 'OTHER');

-- CreateTable
CREATE TABLE "TrendSignal" (
    "id" TEXT NOT NULL,
    "source" "TrendSource" NOT NULL,
    "category" "TrendCategory",
    "keyword" TEXT NOT NULL,
    "brand" TEXT,
    "productHint" TEXT,
    "currentValue" DOUBLE PRECISION NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "velocityPct" DOUBLE PRECISION,
    "crossPlatformScore" INTEGER NOT NULL DEFAULT 1,
    "relatedSignalIds" TEXT[],
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observationCount" INTEGER NOT NULL DEFAULT 1,
    "decayedAt" TIMESTAMP(3),
    "rawPayload" JSONB,

    CONSTRAINT "TrendSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TrendSignal_category_velocityPct_idx" ON "TrendSignal"("category", "velocityPct");

-- CreateIndex
CREATE INDEX "TrendSignal_lastSeenAt_idx" ON "TrendSignal"("lastSeenAt");

-- CreateIndex
CREATE INDEX "TrendSignal_source_lastSeenAt_idx" ON "TrendSignal"("source", "lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrendSignal_source_keyword_key" ON "TrendSignal"("source", "keyword");
