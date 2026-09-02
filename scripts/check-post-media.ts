import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';

async function main() {
  const p = await prisma.post.findFirst({
    where: { id: process.argv[2] ?? 'cmtjt3jz30003qvekw4al12vr' },
    select: { id: true, sourceMediaUrls: true, mediaUrls: true, generatedBody: true, generatedReply: true },
  });
  if (!p) { console.error('not found'); process.exit(1); }
  console.log(`Post ${p.id}`);
  console.log('\n=== sourceMediaUrls (원본) ===');
  p.sourceMediaUrls.forEach((u, i) => {
    const kind = u.includes('.mp4') || u.includes('/video/upload/') ? '🎬 VIDEO' : '🖼️ IMAGE';
    console.log(`  [${i}] ${kind} ${u.slice(0, 140)}`);
  });
  console.log('\n=== mediaUrls (Cloudinary 업로드 결과) ===');
  p.mediaUrls.forEach((u, i) => {
    const kind = u.includes('/video/upload/') ? '🎬 VIDEO' : '🖼️ IMAGE';
    console.log(`  [${i}] ${kind} ${u}`);
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
