import { prisma } from '../../src/db/prisma.js';
import { uploadFromUrl } from '../../src/infra/cloudinary-client.js';
for (const id of process.argv.slice(2)) {
  const p = await prisma.post.findUniqueOrThrow({ where: { id } });
  const v = p.mediaUrls.find((u) => u.includes('/video/upload/'))!;
  const up = await uploadFromUrl({ sourceUrl: v, folder: 'pinpoint-threads/sharing-assets', resourceType: 'video' });
  const poster = up.publicUrl.replace('/video/upload/', '/video/upload/w_720,q_auto,so_40p/').replace(/\.mp4$/, '.jpg');
  const img = await uploadFromUrl({ sourceUrl: poster, folder: 'pinpoint-threads/sharing-assets', resourceType: 'image' });
  await prisma.post.update({ where: { id }, data: { state: 'REJECTED', rejectionReason: '스하리 첨부로 이동' } });
  console.log('ASSET', id, up.publicUrl.split('/').pop(), img.publicUrl.split('/').pop());
}
await prisma.$disconnect(); process.exit(0);
