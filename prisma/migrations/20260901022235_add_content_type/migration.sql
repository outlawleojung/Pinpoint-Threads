-- CreateEnum
CREATE TYPE "ContentType" AS ENUM ('SHOPPING', 'DAILY', 'UNSUITABLE');

-- DropIndex
DROP INDEX "BenchmarkPost_embedding_ivfflat_idx";

-- DropIndex
DROP INDEX "BenchmarkPost_threadsPostId_key";

-- AlterTable
ALTER TABLE "BenchmarkPost" ADD COLUMN     "contentType" "ContentType" DEFAULT 'SHOPPING';
