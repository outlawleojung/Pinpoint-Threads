/**
 * Cloudinary 영상 URL → 시점별 프레임 JPG URL (변환 URL · 추가 업로드 없음).
 * 용도: 카피 생성기가 캡션만 보고 장면을 오해하지 않게 "이해용"으로 보여준다(서술 금지 규칙은 유지).
 *   2026-09-30: 캡션만 보고 "슬리퍼에 이빨 그려놓고"(실제: 앞니 달린 캐릭터 슬리퍼) 같은 오해 반복.
 */
export function isCloudinaryVideo(u: string): boolean {
  return u.includes('res.cloudinary.com') && u.includes('/video/upload/');
}

export function videoFrameUrls(u: string, percents: number[] = [15, 50, 85]): string[] {
  if (!isCloudinaryVideo(u)) return [];
  return percents.map((p) => {
    let out = u.replace('/video/upload/', `/video/upload/w_480,q_auto,so_${p}p/`);
    out = out.replace(/\.(mp4|mov|webm)(\?|$)/i, '.jpg$2');
    if (!/\.jpg(?:\?|$)/i.test(out)) out += '.jpg';
    return out;
  });
}
