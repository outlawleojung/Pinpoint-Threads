import 'dotenv/config';
import { prisma } from '../src/db/prisma.js';
import { tagBenchmarkPost } from '../src/modules/shared/source-collector/viralfactors-tagger.js';

async function main() {
  const posts = await prisma.benchmarkPost.findMany({
    orderBy: { collectedAt: 'desc' },
    take: 5,
  });
  console.log(`re-tagging ${posts.length} recent benchmarks\n`);
  for (const p of posts) {
    console.log(`--- ${p.id} (@${p.sourceHandle}, likes=${p.likesCount}) ---`);
    console.log(`text: ${p.text.slice(0, 80).replace(/\n/g, ' ')}...`);
    try {
      const factors = await tagBenchmarkPost(p.id);
      console.log(`hook: ${factors.hook_type}`);
      console.log(`structure: ${factors.structure}`);
      console.log(`tone: ${factors.tone}`);
      console.log(`topic: ${factors.topic_category}`);
      console.log(`cta: ${factors.cta_type}`);
      console.log(`key: ${factors.key_phrase}`);
      console.log(`reasoning: ${factors.reasoning}`);
    } catch (err: any) {
      console.log(`ERROR: ${err.message}`);
    }
    console.log('');
  }
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
