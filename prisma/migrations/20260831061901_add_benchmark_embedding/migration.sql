-- pgvector 확장 보장 (이미 있으면 idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- BenchmarkPost에 임베딩 컬럼 추가
ALTER TABLE "BenchmarkPost"
  ADD COLUMN "embeddedAt" TIMESTAMP(3),
  ADD COLUMN "embedding" vector(1024);

-- 유사도 검색용 인덱스 (ivfflat, cosine)
-- lists = sqrt(rows). 초기 데이터 소량이라 100. 대량 축적 후 재생성 권장.
CREATE INDEX "BenchmarkPost_embedding_ivfflat_idx"
  ON "BenchmarkPost"
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
