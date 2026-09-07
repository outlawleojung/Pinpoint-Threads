-- CreateTable
CREATE TABLE "NaverTrendKeyword" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'COUPANG_RANKING',
    "rank" INTEGER,
    "value" DOUBLE PRECISION,
    "productHint" TEXT,
    "rawPayload" JSONB,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "NaverTrendKeyword_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NaverTrendKeyword_category_collectedAt_idx" ON "NaverTrendKeyword"("category", "collectedAt");

-- CreateIndex
CREATE INDEX "NaverTrendKeyword_usedAt_idx" ON "NaverTrendKeyword"("usedAt");
