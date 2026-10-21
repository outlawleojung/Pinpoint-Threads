---
name: project_apify_unpaid_relay
description: Apify 미결제(크레딧 소진 2026-09-21~) → 스레드 수집·검색은 비로그인 Playwright Relay 파싱(무료)이 1순위, Apify는 백업
metadata:
  type: project
---

**Apify는 결제 안 함 → 9/21부터 스레드 URL 수집이 미디어 0개로 떨어져 발행량 급감(9/22~ 8일간 6건).** 2026-09-30 `src/infra/threads-relay.ts`(비로그인 헤드리스로 페이지 내장 Relay JSON 파싱)로 교체 — 게시글·프로필·검색 모두 좋아요·영상·캐러셀·끼워넣은 영상(linked_inline_media) 수집 확인.

**Why:** 사용자 "굳이 무료 방식만 찾지 말고 최적의 방법" → 결론: Apify도 같은 비로그인 페이지를 긁을 뿐이라 데이터 이득 없음. 기본=Relay, 막히면 Apify 유료 백업, 장기=공식 API keyword_search(현재 권한 없음·500).

**How to apply:** 스레드 수집 실패/미디어 0 보이면 먼저 Relay 파서(구조 변경·차단) 의심. Apify 호출 에러 `max-total-charge-usd-must-be-greater-than-zero` = 미결제. 스하리 벤치마크 수집(sharing-collector)도 9/30 Relay로 이관(9/19 이후 멈춰 있었음 → 첫 실행 17건 저장). 인스타·틱톡·샤오홍슈 URL 어댑터는 아직 Apify(미결제라 사실상 고장). [[project_source_foreign_viral_only]]
