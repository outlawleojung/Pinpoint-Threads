-- 재탕(재발행) 계보: 위너 원문 복제 발행 시 원본 Post id
ALTER TABLE "Post" ADD COLUMN "repostOfId" TEXT;
CREATE INDEX "Post_repostOfId_idx" ON "Post"("repostOfId");
ALTER TABLE "Post" ADD CONSTRAINT "Post_repostOfId_fkey" FOREIGN KEY ("repostOfId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE;
