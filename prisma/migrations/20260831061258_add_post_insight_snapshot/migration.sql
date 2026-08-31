-- CreateTable
CREATE TABLE "PostInsightSnapshot" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "hoursAfterPublish" INTEGER NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "replies" INTEGER NOT NULL DEFAULT 0,
    "reposts" INTEGER NOT NULL DEFAULT 0,
    "quotes" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "engagementScore" DOUBLE PRECISION,
    "raw" JSONB,

    CONSTRAINT "PostInsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostInsightSnapshot_collectedAt_idx" ON "PostInsightSnapshot"("collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostInsightSnapshot_postId_hoursAfterPublish_key" ON "PostInsightSnapshot"("postId", "hoursAfterPublish");

-- AddForeignKey
ALTER TABLE "PostInsightSnapshot" ADD CONSTRAINT "PostInsightSnapshot_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
