import { llm } from '../../src/infra/llm/index.js';

const SYSTEM_PROMPT = `너는 한국 20대 Threads 유저야. 스하리 글의 앞부분(일상 한마디)만 쓴다.

★★ 규칙:
- 15~25자. 짧을수록 좋다. 한 문장.
- "지금 나한테 일어난 일" 하나만 툭 던져.
- 반말, 담백하게. 감탄사 하나 정도 OK.

★★ 작성법:
1. 힌트 주제를 읽는다.
2. 그 주제와 완전히 다른 소재로, 네 하루에서 겪을 법한 작은 순간을 하나 떠올려.
3. 그걸 혼잣말로 써.

★★ 금지:
- 힌트 주제의 단어를 쓰지 마. 힌트는 방향일 뿐.
- 아래 단어 금지: 커피, 냉장고, 냉동실, 양말, 세탁기, 베개, 택배, 삼각김밥, 이어폰, 유튜브, 쇼츠
- 밤/저녁/퇴근/자기전 금지 (아침 발행)
- 스하리/반하리/맞팔/스친 금지 (시스템이 붙임)
- 격언/다짐/교훈 금지 ("~은 ~이다" "~해야지")
- 불평/하소연 금지
- 숫자/팔로워수 금지
- 30자 넘기지 마.

JSON: { "body": "..." }`;

const SENSE_SEEDS = ['촉감', '냄새', '소리', '맛', '온도', '손끝', '발바닥', '눈앞', '귓가', '혀끝'];
const hooks = [
  '커피 한 잔의 여유',
  '아침 루틴',
  '오늘 뭐 먹지',
  '게으른 나',
  '쇼핑 충동',
  '날씨 좋다',
  '출근길',
  '간식 타임',
];

console.log('=== 스하리 카피 테스트 (개선 프롬프트) ===\n');

for (let i = 0; i < hooks.length; i++) {
  const hook = hooks[i]!;
  const sense = SENSE_SEEDS[i % SENSE_SEEDS.length]!;
  const userPrompt = `힌트: "${hook}"\n감각: ${sense}\n톤: 편한 반말\n힌트 단어 쓰지 마. 전혀 다른 소재로 15~25자 혼잣말. JSON만.`;

  try {
    const r = await llm().complete({
      tier: 'fast',
      system: SYSTEM_PROMPT,
      userParts: [{ type: 'text', text: userPrompt }],
      maxOutputTokens: 200,
      temperature: 1.0,
      jsonMode: true,
      jsonSchema: { type: 'object', properties: { body: { type: 'string' } }, required: ['body'] },
    });
    const cleaned = r.text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    const len = [...parsed.body].length;
    console.log(`[${hook.padEnd(10)}] → "${parsed.body}" (${len}자)`);
  } catch (e: any) {
    console.log(`[${hook.padEnd(10)}] ❌ ${e.message?.slice(0, 60)}`);
  }
}

process.exit(0);
