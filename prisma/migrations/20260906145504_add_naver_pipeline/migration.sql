-- CreateEnum
CREATE TYPE "NaverPostState" AS ENUM ('DRAFT', 'PLANNED', 'READY', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "NaverPostKind" AS ENUM ('INFO', 'AFFILIATE');

-- CreateTable
CREATE TABLE "NaverBlogConfig" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "cadencePerWeek" INTEGER NOT NULL DEFAULT 4,
    "affiliateRatio" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaverBlogConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaverProduct" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productUrl" TEXT NOT NULL,
    "connectUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "price" INTEGER,
    "specsJson" JSONB,
    "imageUrls" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NaverProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NaverPost" (
    "id" TEXT NOT NULL,
    "state" "NaverPostState" NOT NULL DEFAULT 'DRAFT',
    "kind" "NaverPostKind" NOT NULL DEFAULT 'AFFILIATE',
    "topic" TEXT NOT NULL,
    "title" TEXT,
    "draftJson" JSONB,
    "connectUrl" TEXT,
    "imageUrls" TEXT[],
    "productId" TEXT,
    "telegramNotifiedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NaverPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NaverProduct_externalId_idx" ON "NaverProduct"("externalId");

-- CreateIndex
CREATE INDEX "NaverPost_state_idx" ON "NaverPost"("state");

-- CreateIndex
CREATE INDEX "NaverPost_kind_createdAt_idx" ON "NaverPost"("kind", "createdAt");

-- AddForeignKey
ALTER TABLE "NaverPost" ADD CONSTRAINT "NaverPost_productId_fkey" FOREIGN KEY ("productId") REFERENCES "NaverProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
