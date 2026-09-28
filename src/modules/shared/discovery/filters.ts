/**
 * 발굴 후보 공용 필터.
 *
 * 정치·범죄·사건사고·슬픔/죽음 등 일상글 소재로 부적합한 것을 제외한다.
 * ※ 단순 '논란/화제'는 허용([project_daily_content_scope]) — 여기서 거르는 건 범죄·비극·정치.
 * → [feedback_conserve_api_cost] (규칙 기반, LLM 안 씀)
 */

// 정치 (한/일/중/영)
const POLITICS =
  /trump|biden|president|election|politic|republican|democrat|senate|parliament|대통령|정치|선거|국회|의원|여당|야당|首相|政治|選挙|議員|政党|习近平|选举/i;

// 범죄·사건사고·슬픔·죽음·재난 (일상글에 부적합)
const NEGATIVE = new RegExp(
  [
    // 한국어 — 죽음·비극
    '죽', '사망', '부고', '추모', '장례', '참사', '화재', '지진', '재난', '전쟁', '테러', '학대', '살해', '자살', '비극',
    // 한국어 — 범죄·사건사고
    '체포', '기소', '용의', '사건', '사고', '강도', '절도', '폭행', '범인', '사기', '납치', '성폭', '칼부림', '피해자',
    // 일본어 — 죽음·비극
    '訃報', '亡くな', '死ん', '死去', '災害', '地震', '戦争', '虐待', '殺', '自殺', '悲し',
    // 일본어 — 범죄·사건사고
    '逮捕', '容疑', '起訴', '不起訴', '事件', '事故', '強盗', '窃盗', '暴行', '犯人', '詐欺', '刺し', '刺す', '刺され', '襲', '誘拐', '被害',
    // 영어
    'died', 'death', 'funeral', 'accident', 'disaster', 'earthquake', 'war', 'abuse', 'suicide', 'killed',
    'stab', 'arrest', 'robbery', 'assault', 'kidnap', 'fraud',
  ].join('|'),
  'i',
);

// 성인·혐오
const NSFW = /nsfw|onlyfans|porn|xxx|エロ|巨乳|18禁/i;

export function isAllowedText(text: string): boolean {
  const t = text ?? '';
  if (POLITICS.test(t)) return false;
  if (NEGATIVE.test(t)) return false;
  if (NSFW.test(t)) return false;
  return true;
}

/** 후보가 재생산 가능한 미디어를 가졌는지(최소 1개). */
export function hasUsableMedia(mediaCount: number): boolean {
  return mediaCount >= 1;
}
