-- BenchmarkPost 플랫폼 다중화 · InboundLink 승격 참조 지원

-- 1) 이전 unique 제거 (threadsPostId)
ALTER TABLE "BenchmarkPost" DROP CONSTRAINT IF EXISTS "BenchmarkPost_threadsPostId_key";

-- 2) 컬럼 rename threadsPostId → externalPostId
ALTER TABLE "BenchmarkPost" RENAME COLUMN "threadsPostId" TO "externalPostId";

-- 3) 신규 컬럼
ALTER TABLE "BenchmarkPost"
  ADD COLUMN "platform" "InboundPlatform" NOT NULL DEFAULT 'THREADS',
  ADD COLUMN "inboundLinkId" TEXT;

-- 4) 신규 unique
CREATE UNIQUE INDEX "BenchmarkPost_inboundLinkId_key" ON "BenchmarkPost"("inboundLinkId");
CREATE UNIQUE INDEX "BenchmarkPost_platform_externalPostId_key" ON "BenchmarkPost"("platform", "externalPostId");

-- 5) 신규 index
CREATE INDEX "BenchmarkPost_platform_likesCount_idx" ON "BenchmarkPost"("platform", "likesCount");
