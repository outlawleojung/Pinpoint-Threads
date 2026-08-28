-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "mediaUrls" TEXT[],
ADD COLUMN     "replyVariantUsed" INTEGER,
ADD COLUMN     "sourceMediaUrls" TEXT[];
