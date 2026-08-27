-- CreateEnum
CREATE TYPE "CommerceChannel" AS ENUM ('COUPANG', 'MUSINSA');

-- CreateEnum
CREATE TYPE "PostState" AS ENUM ('DRAFT', 'CLASSIFYING', 'MATCHING', 'COPYWRITING', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHING', 'PUBLISHED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "EngagementAction" AS ENUM ('LIKE', 'REPOST', 'REPLY');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "threadsUserId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "personaPrompt" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "activeHourStart" INTEGER NOT NULL DEFAULT 8,
    "activeHourEnd" INTEGER NOT NULL DEFAULT 23,
    "userAgent" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceItem" (
    "id" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "authorHandle" TEXT,
    "language" TEXT,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommerceProduct" (
    "id" TEXT NOT NULL,
    "channel" "CommerceChannel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "deeplinkUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT NOT NULL,
    "price" INTEGER,
    "rating" DOUBLE PRECISION,
    "category" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommerceProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "state" "PostState" NOT NULL DEFAULT 'DRAFT',
    "accountId" TEXT NOT NULL,
    "sourceItemId" TEXT NOT NULL,
    "commerceProductId" TEXT,
    "generatedBody" TEXT,
    "generatedReply" TEXT,
    "mediaUrl" TEXT,
    "telegramMessageId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "threadsPostId" TEXT,
    "threadsReplyId" TEXT,
    "rejectionReason" TEXT,
    "visionMatchScore" DOUBLE PRECISION,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EngagementLog" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "targetHandle" TEXT NOT NULL,
    "targetPostId" TEXT NOT NULL,
    "action" "EngagementAction" NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EngagementLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyPostCount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "publishedCount" INTEGER NOT NULL DEFAULT 0,
    "engagementCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailyPostCount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_handle_key" ON "Account"("handle");

-- CreateIndex
CREATE UNIQUE INDEX "Account_threadsUserId_key" ON "Account"("threadsUserId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceItem_sourceUrl_key" ON "SourceItem"("sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "SourceItem_contentHash_key" ON "SourceItem"("contentHash");

-- CreateIndex
CREATE INDEX "SourceItem_collectedAt_idx" ON "SourceItem"("collectedAt");

-- CreateIndex
CREATE INDEX "CommerceProduct_channel_category_idx" ON "CommerceProduct"("channel", "category");

-- CreateIndex
CREATE UNIQUE INDEX "CommerceProduct_channel_externalId_key" ON "CommerceProduct"("channel", "externalId");

-- CreateIndex
CREATE INDEX "Post_state_idx" ON "Post"("state");

-- CreateIndex
CREATE INDEX "Post_scheduledAt_idx" ON "Post"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "Post_accountId_commerceProductId_createdAt_key" ON "Post"("accountId", "commerceProductId", "createdAt");

-- CreateIndex
CREATE INDEX "EngagementLog_accountId_executedAt_idx" ON "EngagementLog"("accountId", "executedAt");

-- CreateIndex
CREATE INDEX "DailyPostCount_date_idx" ON "DailyPostCount"("date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyPostCount_accountId_date_key" ON "DailyPostCount"("accountId", "date");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_commerceProductId_fkey" FOREIGN KEY ("commerceProductId") REFERENCES "CommerceProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EngagementLog" ADD CONSTRAINT "EngagementLog_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyPostCount" ADD CONSTRAINT "DailyPostCount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
