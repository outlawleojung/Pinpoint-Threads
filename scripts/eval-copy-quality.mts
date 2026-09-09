// 쇼핑 카피 3갭 라이브 평가 (실 LLM 사용 · DB/발행/텔레그램 없음).
// 4개 상품군 × 3회 생성 → LLM-judge 로 밋밋마무리·범용감탄·미확인주장 flag rate 측정.
// 실행: npm run eval:copy
import { generateCopy } from '../src/modules/shared/copywriter/index.ts';
import { llm } from '../src/infra/llm/index.ts';

const SAMPLES = [
  { cat: '패션·신발', productName: '오니츠카타이거 메쉬 뮬', sourceText: 'この網目のミュール可愛すぎる、夏の主役', lang: 'ja' },
  { cat: '뷰티·스킨케어', productName: '데이지크 포어 블러 프라이머', sourceText: '塗るだけで毛穴が消える、化粧のりが違う', lang: 'ja' },
  { cat: '생활용품', productName: '무인양품 신발 클리너', sourceText: '泡つけるだけで汚れが落ちる、靴を洗濯機に入れなくていい', lang: 'ja' },
  { cat: '식품', productName: '글리코 포키 딸기', sourceText: 'このお菓子止まらない、いくらでも食べれる', lang: 'ja' },
];

async function judge(body: string, productName: string): Promise<{ weakEnd: boolean; generic: boolean; unverified: boolean }> {
  const r = await llm().complete({
    tier: 'main', thinking: 'disabled', jsonMode: true,
    system: '너는 한국 쇼핑 카피 심사관이다. 아래 카피에 대해 JSON만 반환.',
    userParts: [{ type: 'text', text:
`상품:${productName}\n카피:"""${body}"""\n판정(각 true=문제 있음):\n` +
`weakEnd: 끝 문장이 앞 문장을 그대로 반복하는가(같은 말 두 번). 하입 마무리("이거 하나로 끝")·담백한 끝은 문제 아님\n` +
`generic: 상품 고유 특징이 하나도 없이 아무 상품에나 붙는 문장뿐인가. 구체 디테일(그물망·모공·거품 등) 하나라도 있으면 문제 아님\n` +
`unverified: 지어낸 사회적 증거(다들 산다·품절대란·없어서 못 삼) 또는 원본에 없는 타제품 비교를 넣었는가. 제품 종류에 맞는 기능 반응·주관적 기대는 문제 아님\n` +
`{"weakEnd":bool,"generic":bool,"unverified":bool}` }],
    jsonSchema: { type: 'object', properties: { weakEnd: { type: 'boolean' }, generic: { type: 'boolean' }, unverified: { type: 'boolean' } }, required: ['weakEnd', 'generic', 'unverified'] },
  });
  return JSON.parse(r.text.trim().replace(/^```(?:json)?/, '').replace(/```$/, ''));
}

const flags = { weakEnd: 0, generic: 0, unverified: 0 };
let n = 0;
for (const s of SAMPLES) {
  for (let i = 0; i < 3; i++) {
    const r = await generateCopy({ sourceText: s.sourceText, sourceLanguage: s.lang, productName: s.productName, productCategory: s.cat, personaPrompt: '20대 여성. 솔직 리액션. 반말.', accountSeed: `eval-${s.cat}-${i}`, ragEnabled: false, factCheckEnabled: true });
    const j = await judge(r.body, s.productName);
    n++;
    if (j.weakEnd) flags.weakEnd++;
    if (j.generic) flags.generic++;
    if (j.unverified) flags.unverified++;
    console.log(`[${s.cat}] weak:${j.weakEnd ? 'X' : 'O'} generic:${j.generic ? 'X' : 'O'} unver:${j.unverified ? 'X' : 'O'} | ${r.body.replace(/\n/g, ' ')}`);
  }
}
console.log(`\n=== ${n}건 · flag rate (낮을수록 좋음) ===`);
console.log(`밋밋/반복 마무리: ${(flags.weakEnd / n * 100).toFixed(0)}% · 범용감탄: ${(flags.generic / n * 100).toFixed(0)}% · 미확인주장: ${(flags.unverified / n * 100).toFixed(0)}%`);
process.exit(0);
