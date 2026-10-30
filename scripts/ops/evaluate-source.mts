/**
 * 소싱 평가 스크립트 — 상품/원본 URL의 클릭 잠재력을 5가지 기준으로 평가.
 *
 * 사용법:
 *   npx tsx scripts/ops/evaluate-source.mts <threads-url>
 *
 * 원본 글에서 소스 브리프를 뽑고, AI로 클릭 잠재력을 점수화한다.
 * 결과: 5가지 기준별 점수(1~5) + 총평 + 추천 카피 구조.
 */

import { llm } from '../../src/infra/llm/index.js';
import { PRODUCT_SELECTION_CRITERIA, CLICK_COPY_STRUCTURES, renderSourcingGuide } from '../../src/modules/shared/copywriter/winning-style.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: npx tsx scripts/ops/evaluate-source.mts <threads-url>');
  process.exit(1);
}

console.log(`\n🔍 소싱 평가: ${url}\n`);

const systemPrompt = `너는 스레드 쇼핑 콘텐츠 전략가다. 주어진 원본 URL의 상품이 "클릭을 만드는 상품"인지 5가지 기준으로 냉정하게 평가한다.

${renderSourcingGuide()}

평가는 반드시 아래 JSON으로:
{
  "productName": "상품명 추정",
  "scores": {
    "visual": { "score": 1-5, "reason": "한 줄" },
    "impulsePrice": { "score": 1-5, "reason": "한 줄" },
    "problemSolving": { "score": 1-5, "reason": "한 줄" },
    "trending": { "score": 1-5, "reason": "한 줄" },
    "controversy": { "score": 1-5, "reason": "한 줄" }
  },
  "totalScore": 가중합(visual*0.3 + impulsePrice*0.2 + problemSolving*0.2 + trending*0.15 + controversy*0.15),
  "verdict": "GO" | "MAYBE" | "SKIP",
  "recommendedStructure": "문제→반전 / 회의→반전 / 경쟁템 저격 / 반어적 극찬 / before/after 중 하나",
  "hookSuggestion": "이 상품에 맞는 첫 줄 훅 예시 한 줄",
  "reason": "총평 2줄"
}

verdict 기준: totalScore ≥ 3.5 → GO, 2.5~3.4 → MAYBE, < 2.5 → SKIP`;

const result = await llm({
  model: 'haiku',
  system: systemPrompt,
  messages: [
    {
      role: 'user',
      content: `이 원본을 평가해줘: ${url}\n\n(URL만으로 판단이 어려우면 URL에서 보이는 정보 + 일반적인 상품 특성으로 추정해서 평가. "잘 모르겠다"보다는 가용 정보로 최선의 판단.)`,
    },
  ],
  maxTokens: 1000,
});

try {
  const text = typeof result === 'string' ? result : (result as any).content?.[0]?.text ?? JSON.stringify(result);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.log(text);
    process.exit(0);
  }

  const eval_ = JSON.parse(jsonMatch[0]);

  console.log(`📦 상품: ${eval_.productName}`);
  console.log(`\n📊 클릭 잠재력 평가:`);
  console.log(`  ① 비주얼 임팩트:  ${'★'.repeat(eval_.scores.visual.score)}${'☆'.repeat(5 - eval_.scores.visual.score)}  ${eval_.scores.visual.reason}`);
  console.log(`  ② 충동 가격대:    ${'★'.repeat(eval_.scores.impulsePrice.score)}${'☆'.repeat(5 - eval_.scores.impulsePrice.score)}  ${eval_.scores.impulsePrice.reason}`);
  console.log(`  ③ 문제해결력:     ${'★'.repeat(eval_.scores.problemSolving.score)}${'☆'.repeat(5 - eval_.scores.problemSolving.score)}  ${eval_.scores.problemSolving.reason}`);
  console.log(`  ④ 트렌드·화제성:  ${'★'.repeat(eval_.scores.trending.score)}${'☆'.repeat(5 - eval_.scores.trending.score)}  ${eval_.scores.trending.reason}`);
  console.log(`  ⑤ 논쟁 소재:      ${'★'.repeat(eval_.scores.controversy.score)}${'☆'.repeat(5 - eval_.scores.controversy.score)}  ${eval_.scores.controversy.reason}`);
  console.log(`\n  총점: ${eval_.totalScore.toFixed(1)} / 5.0`);

  const verdictEmoji = eval_.verdict === 'GO' ? '🟢' : eval_.verdict === 'MAYBE' ? '🟡' : '🔴';
  console.log(`  판정: ${verdictEmoji} ${eval_.verdict}`);
  console.log(`\n💡 추천 카피 구조: ${eval_.recommendedStructure}`);
  console.log(`📝 훅 예시: ${eval_.hookSuggestion}`);
  console.log(`\n${eval_.reason}`);
} catch {
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}
