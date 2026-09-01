-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "followersCount" INTEGER,
ADD COLUMN     "followersSyncedAt" TIMESTAMP(3);
