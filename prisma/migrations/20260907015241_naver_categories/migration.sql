-- AlterTable
ALTER TABLE "NaverBlogConfig" ADD COLUMN     "categories" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "NaverPost" ADD COLUMN     "category" TEXT;
