import 'dotenv/config';
import { ingestUrl } from '../src/modules/shared/url-ingester/index.js';

const TEST_URL = process.argv[2] ?? 'https://www.threads.com/@yuji.ni1122/post/DcsmMV5kQ6N';

async function main() {
  console.log(`\n=== Lane 1 테스트: Threads URL 인제스트 ===`);
  console.log(`URL: ${TEST_URL}\n`);

  try {
    const result = await ingestUrl({
      url: TEST_URL,
      source: 'MANUAL_TELEGRAM',
    });
    console.log('결과:', JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('에러:', err.message);
    if (err.stack) console.error(err.stack);
  }

  process.exit(0);
}

main();
