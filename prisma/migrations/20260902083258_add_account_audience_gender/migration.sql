-- CreateEnum
CREATE TYPE "AudienceGender" AS ENUM ('male', 'female', 'unisex');

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "audienceGender" "AudienceGender" NOT NULL DEFAULT 'unisex';
