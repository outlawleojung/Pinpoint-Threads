/**
 * 브랜드 일치 검사 (2026-09-30 사고: 원본 "無印良品 양말" → 쿠팡 "두발로 무지 양말"로 매칭돼 승인 카드까지 감).
 *
 * 원본 텍스트에 알려진 브랜드가 있는데 매칭된 상품명에 그 브랜드가 없으면 **다른 상품**으로 본다.
 * 브랜드 자체가 훅(네임밸류)인 글이 많아 다른 브랜드로 바꿔치기하면 글의 포인트가 사라진다.
 * 사용자가 상품명을 직접 준 경우(productNameHint)는 사용자 판단을 신뢰해 검사하지 않는다(호출부에서).
 * 규칙 기반(LLM 없음). 목록은 원본에 자주 나오는 브랜드 위주 — 필요 시 추가.
 */

const BRANDS: Array<{ name: string; aliases: string[] }> = [
  { name: '무인양품', aliases: ['無印良品', '無印', 'muji', '무인양품', '무지루시'] },
  { name: '다이소', aliases: ['ダイソー', '大創', 'daiso', '다이소'] },
  { name: '유니클로', aliases: ['ユニクロ', 'uniqlo', '優衣庫', '유니클로'] },
  { name: '니토리', aliases: ['ニトリ', 'nitori', '니토리'] },
  { name: '3COINS', aliases: ['3coins', 'スリーコインズ', '쓰리코인즈'] },
  { name: '돈키호테', aliases: ['ドン・キホーテ', 'ドンキ', '唐吉訶德', 'donki', '돈키호테'] },
  { name: '이케아', aliases: ['ikea', 'イケア', '宜家', '이케아'] },
  { name: '올리브영', aliases: ['올리브영', 'oliveyoung', 'olive young'] },
  { name: '코스트코', aliases: ['costco', 'コストコ', '好市多', '코스트코'] },
  { name: '나이키', aliases: ['nike', 'ナイキ', '耐吉', '耐克', '나이키'] },
  { name: '아디다스', aliases: ['adidas', 'アディダス', '愛迪達', '阿迪达斯', '아디다스'] },
  { name: '아식스', aliases: ['asics', 'アシックス', '亞瑟士', '아식스'] },
  { name: '오니츠카타이거', aliases: ['onitsuka', 'オニツカ', '鬼塚虎', '오니츠카'] },
  { name: '뉴발란스', aliases: ['new balance', 'newbalance', 'ニューバランス', '紐巴倫', '뉴발란스', '뉴발'] },
  { name: '살로몬', aliases: ['salomon', 'サロモン', '薩洛蒙', '살로몬'] },
  { name: '크록스', aliases: ['crocs', 'クロックス', '卡駱馳', '크록스'] },
  { name: '버켄스탁', aliases: ['birkenstock', 'ビルケンシュトック', '勃肯', '버켄스탁'] },
  { name: '아페쎄', aliases: ['a.p.c', 'apc', 'アーペーセー', '아페쎄'] },
  { name: '샤넬', aliases: ['chanel', 'シャネル', '香奈兒', '샤넬'] },
  { name: '디올', aliases: ['dior', 'ディオール', '迪奧', '디올'] },
  { name: '코치', aliases: ['coach', 'コーチ', '蔻馳', '코치'] },
  { name: '프라다', aliases: ['prada', 'プラダ', '普拉達', '프라다'] },
  { name: '조말론', aliases: ['jo malone', 'jomalone', 'ジョーマローン', '祖瑪瓏', '조말론'] },
  { name: '이솝', aliases: ['aesop', 'イソップ', '伊索', '이솝'] },
  { name: '애플', aliases: ['apple', 'iphone', 'airpods', 'アップル', '蘋果', '애플', '아이폰', '에어팟'] },
  { name: '다이슨', aliases: ['dyson', 'ダイソン', '戴森', '다이슨'] },
  { name: '조지루시', aliases: ['zojirushi', '象印', '조지루시'] },
  { name: '써모스', aliases: ['thermos', 'サーモス', '膳魔師', '써모스'] },
  { name: '스탠리', aliases: ['stanley', 'スタンレー', '스탠리'] },
  { name: '키엘', aliases: ["kiehl", 'キールズ', '契爾氏', '키엘'] },
  { name: '라로슈포제', aliases: ['la roche', 'ラロッシュポゼ', '理膚寶水', '라로슈포제'] },
];

const lower = (s: string) => s.toLowerCase();

export function detectBrands(text: string): string[] {
  const t = lower(text ?? '');
  return BRANDS.filter((b) => b.aliases.some((a) => t.includes(lower(a)))).map((b) => b.name);
}

/**
 * 원본 브랜드와 매칭 상품 브랜드가 어긋나면 사유 문자열, 괜찮으면 null.
 * 원본에 브랜드가 여러 개면 그중 하나라도 상품명에 있으면 통과.
 */
export function brandMismatch(sourceText: string, productName: string): string | null {
  const src = detectBrands(sourceText);
  if (src.length === 0) return null;
  const prod = lower(productName ?? '');
  const ok = src.some((name) => BRANDS.find((b) => b.name === name)!.aliases.some((a) => prod.includes(lower(a))));
  if (ok) return null;
  return `원본 브랜드(${src.join('·')})와 매칭 상품("${productName.slice(0, 40)}")이 다름 → 다른 상품이라 글 포인트가 사라짐. 상품명을 직접 주세요 (예: "URL ${src[0]} 양말")`;
}
