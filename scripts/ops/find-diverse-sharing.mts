// 벤치마크 DB에서 패턴별 다양한 스하리 글 탐색
import { prisma } from '../../src/db/prisma.js';

// 패턴 분류
function classify(text: string): string {
  const t = text.replace(/\s+/g, ' ');
  if (/의리|뒷삭|반하리.*무조건|무조건.*반하리|진짜.*바로|1분.*컷|100%/.test(t)) return '의리';
  if (/\d+\s*명|넘고\s*싶|남았|채우|목표|달성/.test(t)) return '마일스톤';
  if (/골라|결정해|뭐\s*먹|뭐\s*할|어떤.*좋아|추천|투표|남겨줘|알려줘|봐줄게/.test(t)) return '참여유도';
  if (/ㅋㅋ|ㅎㅎ|웃긴|미친|레전드|개웃|빵터/.test(t)) return '유머';
  if (/안녕|나는|시작했|처음|입문|자기소개/.test(t)) return '인사';
  if (/출근|퇴근|커피|피곤|배고|심심|아침|점심/.test(t)) return '일상순간';
  if (/\?|맞아|어려운|힘든|왜.*이렇|진짜야|나만/.test(t)) return '질문';
  if (/달리자|화이팅|가보자|🔥|💪|파이팅|가즈아/.test(t)) return '에너지';
  return '✨기타';
}

// 최근 30일 벤치마크 전부 가져오기
const since = new Date(Date.now() - 30 * 864e5);
const all = await prisma.benchmarkPost.findMany({
  where: { contentType: 'SHARING', collectedAt: { gte: since }, text: { not: '' } },
  orderBy: { repliesCount: 'desc' },
  take: 500,
  select: { id: true, sourceHandle: true, text: true, repliesCount: true, likesCount: true, collectedAt: true },
});

console.log(`총 ${all.length}개 벤치마크 (최근 30일)\n`);

// 패턴별 그룹핑
const groups = new Map<string, typeof all>();
for (const b of all) {
  const pat = classify(b.text);
  if (!groups.has(pat)) groups.set(pat, []);
  groups.get(pat)!.push(b);
}

// 패턴별 통계 + 상위 예시
for (const [pat, items] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  const avgReplies = Math.round(items.reduce((s, i) => s + (i.repliesCount ?? 0), 0) / items.length);
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📌 ${pat} — ${items.length}개 (평균 댓글 ${avgReplies})`);
  console.log('='.repeat(60));

  // 상위 5개만
  for (const b of items.slice(0, 5)) {
    const txt = b.text.replace(/\n/g, ' ').slice(0, 100);
    console.log(`  💬${b.repliesCount ?? 0} ❤️${b.likesCount ?? 0} | @${b.sourceHandle}`);
    console.log(`     ${txt}`);
  }
}

// ★ "✨기타" 카테고리 중 댓글 50+ 글만 따로 — 이게 진짜 쓸만한 거
const others = (groups.get('✨기타') ?? []).filter(b => (b.repliesCount ?? 0) >= 50);
console.log(`\n${'='.repeat(60)}`);
console.log(`🌟 ✨기타 중 댓글 50+: ${others.length}개 — 벤치마크로 쓸만한 후보`);
console.log('='.repeat(60));
for (const b of others.slice(0, 20)) {
  const txt = b.text.replace(/\n/g, ' ').slice(0, 120);
  console.log(`  💬${b.repliesCount ?? 0} | @${b.sourceHandle}`);
  console.log(`     ${txt}`);
}

// "일상순간" + "질문" 도 50+ 보기
for (const target of ['일상순간', '질문', '참여유도', '유머']) {
  const pool = (groups.get(target) ?? []).filter(b => (b.repliesCount ?? 0) >= 50);
  if (pool.length === 0) continue;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🌟 ${target} 중 댓글 50+: ${pool.length}개`);
  console.log('='.repeat(60));
  for (const b of pool.slice(0, 10)) {
    const txt = b.text.replace(/\n/g, ' ').slice(0, 120);
    console.log(`  💬${b.repliesCount ?? 0} | @${b.sourceHandle}`);
    console.log(`     ${txt}`);
  }
}

await prisma.$disconnect();
