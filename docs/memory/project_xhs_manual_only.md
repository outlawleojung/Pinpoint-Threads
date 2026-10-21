---
name: project-xhs-manual-only
description: "샤오홍슈(XHS)는 텔레그램 수동 URL 인제스트만 사용, 자율 트렌드 검색 대상에서 제외"
metadata: 
  node_type: memory
  type: project
  originSessionId: 8cbf27b2-79e7-49e0-86fa-597c09c5b7a5
  modified: 2026-09-01T03:45:29.698Z
---

샤오홍슈(XHS) 콘텐츠 수집은 **Lane 1 (사용자 수동 URL 시딩) 전용**. Lane 2 (자율 트렌드 검색) 파이프라인에서 XHS 검색은 하지 않음.

**Why**: XHS 액터가 다른 플랫폼 대비 4~10배 비쌈 ($10~$40/1K vs Threads $2/1K, IG $1.70/1K, TikTok $3/1K). 중국 봇 감지·프록시·유지보수 특성상 앞으로도 저렴해질 여지 없음. 수동 시딩(하루 2~3개 · 월 $1.5~$3)은 감수 가능하지만, 자율 검색은 노이즈 대비 비용 과다.

**How to apply**:
- XHS URL 어댑터(zen-studio/rednote-note-detail-scraper 등)는 텔레그램 봇에서 사용자가 던진 URL만 처리
- Lane 2 자율 트렌드 검색기(search-orchestrator) 구현 시 XHS는 대상 플랫폼 목록에서 제외
- 자율 검색 대상: Threads · Instagram · TikTok 3개만
- 정책 재고 트리거: XHS 액터 시장에 $3/1K 이하 신규 등장 시

관련: [[feedback-verify-before-done]]
