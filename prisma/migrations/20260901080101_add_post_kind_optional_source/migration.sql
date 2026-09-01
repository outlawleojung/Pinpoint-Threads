-- CreateEnum
CREATE TYPE "PostKind" AS ENUM ('SHOPPING', 'SHARING', 'DAILY');

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_sourceItemId_fkey";

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "kind" "PostKind" NOT NULL DEFAULT 'SHOPPING',
ALTER COLUMN "sourceItemId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_sourceItemId_fkey" FOREIGN KEY ("sourceItemId") REFERENCES "SourceItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
