-- CreateTable
CREATE TABLE "SeedSource" (
    "id" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastPolledAt" TIMESTAMP(3),
    "lastError" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeedSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BenchmarkPost" (
    "id" TEXT NOT NULL,
    "seedSourceId" TEXT,
    "sourceHandle" TEXT NOT NULL,
    "threadsPostId" TEXT NOT NULL,
    "permalink" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "mediaUrls" TEXT[],
    "likesCount" INTEGER NOT NULL DEFAULT 0,
    "repliesCount" INTEGER NOT NULL DEFAULT 0,
    "repostsCount" INTEGER NOT NULL DEFAULT 0,
    "quotesCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viralFactors" JSONB,
    "taggedAt" TIMESTAMP(3),

    CONSTRAINT "BenchmarkPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SeedSource_handle_key" ON "SeedSource"("handle");

-- CreateIndex
CREATE INDEX "SeedSource_isActive_idx" ON "SeedSource"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkPost_threadsPostId_key" ON "BenchmarkPost"("threadsPostId");

-- CreateIndex
CREATE UNIQUE INDEX "BenchmarkPost_contentHash_key" ON "BenchmarkPost"("contentHash");

-- CreateIndex
CREATE INDEX "BenchmarkPost_sourceHandle_likesCount_idx" ON "BenchmarkPost"("sourceHandle", "likesCount");

-- CreateIndex
CREATE INDEX "BenchmarkPost_likesCount_idx" ON "BenchmarkPost"("likesCount");

-- CreateIndex
CREATE INDEX "BenchmarkPost_collectedAt_idx" ON "BenchmarkPost"("collectedAt");

-- CreateIndex
CREATE INDEX "BenchmarkPost_taggedAt_idx" ON "BenchmarkPost"("taggedAt");

-- AddForeignKey
ALTER TABLE "BenchmarkPost" ADD CONSTRAINT "BenchmarkPost_seedSourceId_fkey" FOREIGN KEY ("seedSourceId") REFERENCES "SeedSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;
