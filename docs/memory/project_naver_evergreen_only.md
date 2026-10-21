---
name: project_naver_evergreen_only
description: 네이버 자동생성 주제는 에버그린 노하우만 · 지명·가격·절차·자격 등 팩트 취약 주제 배제
metadata: 
  node_type: memory
  type: project
  originSessionId: c9e945a8-513e-4ad5-9c6f-252a5300845a
  modified: 2026-09-09T06:17:30.261Z
---

네이버 글 자동 생성은 **에버그린 노하우 주제만** 뽑는다. **지명·매장·영업시간·가격/시세·신청 절차·과태료/수수료·자격증/취업처럼 "그때그때·지역별로 확인해야 아는 실사실"이 필요한 주제는 배제.**

**Why:** 실수요(자동완성) 그대로 믿으면 검색량 높은 "어디·얼마·지역 절차"형 주제가 뽑히는데, LLM이 지명·영업시간·가격을 지어냄(할루시네이션). 실측: "홍대 빈티지 소품샵 투어"가 "상수역 1번 출구 골목", "오후 2시 전 문 안 엶" 등 확인 불가한 사실을 단정 → 발행 시 독자 헛걸음·신뢰 붕괴. 반면 방법·기준·배치·관리·비교 같은 노하우는 LLM 일반지식+추론으로 진짜 가치 제공.

**How to apply:** `pipeline-d/demand`의 `isFactFragile` 정규식이 후보 풀에서 팩트취약 쿼리 제거 + `selectDemandTopic` 프롬프트가 실시간·지역 사실 주제 선택 금지. 새 위험 패턴 발견 시 FACT_FRAGILE에 추가. 지역·가격 정보가 꼭 필요한 글은 사람이 실제 데이터를 줘야 함(자동 X). 관련 [[feedback_naver_engaging_not_dry]] · 설계 docs/superpowers/specs/2026-09-09-naver-demand-driven-alzza-content.md.
