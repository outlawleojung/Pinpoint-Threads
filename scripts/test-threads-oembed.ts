import 'dotenv/config';
import { request } from 'undici';
import { prisma } from '../src/db/prisma.js';

async function main() {
  // 아무 계정 access token 하나 사용
  const acc = await prisma.account.findFirstOrThrow({
    where: { isActive: true },
    select: { handle: true, accessToken: true },
  });
  console.log(`Using @${acc.handle} token\n`);

  const postUrl = 'https://www.threads.net/@mon.i1l/post/DctUf-9Gt2N';
  const params = new URLSearchParams({ url: postUrl, access_token: acc.accessToken });

  const res = await request(`https://graph.threads.net/v1.0/oembed?${params}`, { method: 'GET' });
  const body = await res.body.text();
  console.log(`HTTP ${res.statusCode}\n${body.slice(0, 2000)}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
