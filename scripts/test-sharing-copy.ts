import 'dotenv/config';
import { generateSharingCopy } from '../src/modules/pipeline-b/sharing-copywriter/index.js';

async function main() {
  const variantCount = Number(process.argv[2] ?? '5');
  console.log(`=== 스하리 글 각색 ${variantCount}개 생성 ===\n`);
  const result = await generateSharingCopy({ variantCount });
  console.log(`참고 벤치마크 ${result.referencesUsed.length}건: ${result.referencesUsed.map((r) => `@${r.sourceHandle}(${r.repliesCount})`).join(', ')}\n`);
  result.bodies.forEach((b, i) => {
    console.log(`── variant ${i + 1} ──`);
    console.log(b);
    console.log();
  });
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
