import { env } from '../../../config/env.js';
import { buildNaverPost } from '../../pipeline-d/post-builder/index.js';

export async function handleNaverCommand(connectUrl: string): Promise<string> {
  if (!connectUrl || !/^https?:\/\//.test(connectUrl)) {
    return '사용법: /naver <쇼핑커넥트 링크>\n예: /naver https://smartstore.naver.com/x/products/123';
  }
  const out = await buildNaverPost({ connectUrl });
  const pageUrl = `http://localhost:${env.APP_PORT}/admin/naver/${out.naverPostId}`;
  const warn = out.ratioWarning ? `\n${out.ratioWarning}` : '';
  return `✅ 네이버 원고 생성 완료\n제목: ${out.title}\n발행 페이지: ${pageUrl}${warn}`;
}
