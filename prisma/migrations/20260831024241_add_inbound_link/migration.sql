-- CreateEnum
CREATE TYPE "InboundPlatform" AS ENUM ('THREADS', 'TIKTOK', 'XIAOHONGSHU', 'INSTAGRAM', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "InboundSource" AS ENUM ('MANUAL_TELEGRAM', 'AUTONOMOUS_TREND');

-- CreateEnum
CREATE TYPE "InboundStatus" AS ENUM ('RECEIVED', 'FETCHING', 'FETCHED', 'CLASSIFYING', 'MATCHING', 'READY_FOR_APPROVAL', 'APPROVED', 'PUBLISHED', 'REJECTED', 'FAILED');

-- CreateTable
CREATE TABLE "InboundLink" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "platform" "InboundPlatform" NOT NULL,
    "source" "InboundSource" NOT NULL,
    "status" "InboundStatus" NOT NULL DEFAULT 'RECEIVED',
    "rawText" TEXT,
    "rawLanguage" TEXT,
    "mediaUrls" TEXT[],
    "authorHandle" TEXT,
    "authorFollowers" INTEGER,
    "engagement" JSONB,
    "publishedAt" TIMESTAMP(3),
    "sourceItemId" TEXT,
    "postIds" TEXT[],
    "trendSignalId" TEXT,
    "errorMessage" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InboundLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InboundLink_normalizedUrl_key" ON "InboundLink"("normalizedUrl");

-- CreateIndex
CREATE INDEX "InboundLink_status_platform_idx" ON "InboundLink"("status", "platform");

-- CreateIndex
CREATE INDEX "InboundLink_source_receivedAt_idx" ON "InboundLink"("source", "receivedAt");

-- CreateIndex
CREATE INDEX "InboundLink_receivedAt_idx" ON "InboundLink"("receivedAt");
