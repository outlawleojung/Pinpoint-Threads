---
name: project_threads_video_extract_html_fallback
description: Threads 영상이 커버 스틸로 발행되면 = Playwright 추출기 문제 · HTML(Relay) mp4 폴백으로 해결됨
metadata:
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-17T09:00:36.353Z
---

**증상:** 원본이 릴/영상인데 카드·발행 미디어가 커버 프레임(JPG 스틸)로만 들어감. 사용자가 "비디오인데 캡처로 발행됐잖아"로 지적. 영상은 이미지보다 도달 ~9.5배라 반드시 영상으로 나가야 함.

**원인:** Apify 스크래퍼가 영상의 커버 프레임(`video_default_cover_frame` 마커 · IG CDN `t51.71878-15` 패턴)만 저장 → `ensureBenchmarkVideo`가 `extractThreadsVideoUrls`(Playwright)로 실제 mp4를 구제해야 하는데, 추출기가 `<video>` DOM·네트워크 응답에만 의존. Threads는 **영상 재생 전엔 `<video>`를 안 만들어서** 헤드리스에서 domCount·networkCount 둘 다 0 → mp4 못 잡고 스틸 폴백.

**해결(커밋 대기, 세션 2026-09-17):** `src/infra/playwright-threads-video.ts`에 (1) `chromium.launch args: --autoplay-policy=no-user-gesture-required --mute-audio`(자동재생 강제), (2) DOM·네트워크가 비면 `page.content()` HTML의 Relay 캐시에서 `"url":"...mp4..."` 파싱하는 `parseMp4sFromHtml` 폴백 추가. source:"html"로 로그 남음. target 게시글이 Relay 앞쪽 렌더라 첫 mp4가 타깃일 확률 높음.

**How to apply:** 영상이 스틸로 나가면 이 폴백이 도는지 확인(로그 source). 커스텀 발행 때 원본이 영상이면 `hasVideo:true` 전달([[project_reply_link_repeat]]·custom-publish 경로). 관련: [[feedback_image_understand_not_describe]].
