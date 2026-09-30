---
title: 강의 정리 인덱스 — 3분 스레드 (쿠팡 파트너스)
status: reference
date: 2026-09-29
related:
  - docs/00-overview/course-tactics.md
  - docs/00-overview/revenue-playbook.md
---

# 강의 정리 인덱스

강의별로 **각각** 핵심 전술을 정리하고, 그중 우리 시스템(프롬프트·발행 로직)에 반영할 것은 코드화한다.
(틱톡·뉴스픽 관련 내용은 우리와 무관 → 제외.)

## 파이프라인 (강의 1개당)
1. **다운로드**: 네이버 카페 임베드 Vimeo → yt-dlp (오디오만, `--referer` + Vimeo id/hash). 슬라이드 PDF는 텍스트 없는 이미지라 OCR 불가 → 보조로 특정 페이지만 vision.
2. **전사**: faster-whisper large-v3, GPU(int8_float16). 6h ≈ 1h(6배속). 출력 `Downloads/*.transcript.txt`.
3. **전술 추출**: 서브에이전트가 전사문 마이닝 → 카테고리별 실행 규칙(⛔하드/★권장 + 타임스탬프).
4. **정리**: 강의별 문서 `course-<라벨>.md` 작성.
5. **코드화**: 시스템 소관 규칙만 프롬프트·로직에 반영(사람 운영 규칙은 문서로만).

## 강의별 정리 문서 (총 12개: 정규 4 + 마스터반 3 + 피드백 5)
| # | 강의 | Vimeo id | 문서 | 상태 |
|---|---|---|---|---|
| 1 | 정규강의 1강 (계정 안전·세팅·카피 기초) | 1168694502 | [course-tactics.md](course-tactics.md) | ✅ 완료 |
| 2 | 정규강의 2강 (카피·소싱·수익화 심화) | 1170873163 | [course-tactics-2강.md](course-tactics-2강.md) | ✅ 완료 |
| 3 | 정규강의 3강 (볼륨 시스템·소싱·수익화 운영) | 1173135822 | [course-tactics-3강.md](course-tactics-3강.md) | ✅ 정리 (코드는 통합 때) |
| 4 | 정규강의 4강 (1·2부: 운영 스케일·채널 확장) | 1175355170 / 1176398966 | [course-tactics-4강.md](course-tactics-4강.md) | ✅ 정리 (코드는 통합 때) |
| 5 | 마스터반 1강 (쇼핑릴스·광고제안서·로드맵) | 1177532623 | [course-master-1.md](course-master-1.md) | ✅ 정리 (코드는 통합 때) |
| 6 | 마스터반 2강 (발행량 스케일 공식) | 1179749350 | [course-master-2.md](course-master-2.md) | ✅ 정리 (코드는 통합 때) |
| 7 | 마스터반 3강 (캐러셀·해외제휴·계정회복) | 1181779936 | [course-master-3.md](course-master-3.md) | ✅ 정리 (코드는 통합 때) |
| 8 | 피드백 1강 | 1170136173 | [course-feedback-1.md](course-feedback-1.md) | ✅ 완료 |
| 9 | 피드백 2강 (1·2부) | 1172377468 / 1172415521 | [course-feedback-2.md](course-feedback-2.md) | ✅ 완료 |
| 10 | 피드백 3강 (성과분석·전략운영) | 1179072804 | [course-feedback-3.md](course-feedback-3.md) | ✅ 정리 (코드는 통합 때) |
| 11 | 피드백 4강 (릴스 확장·스레드 전략) | 1181018891 | [course-feedback-4.md](course-feedback-4.md) | ✅ 정리 (코드는 통합 때) |
| 12 | 피드백 5강 | — | — | ⏳ URL 대기 |

> 처리: 다운로드는 병렬, **전사는 GPU 1개라 순차**(강의당 ~1h). 12개면 전사 총 ~12h(백그라운드·야간 가능).
> 피드백 강의(8~12)는 수강생 글 첨삭 위주라 전술 밀도가 낮을 수 있음 — 그래도 실전 첨삭 팁 위주로 뽑음.

## 코드화 반영 로그 (강의 → 코드)
- **1강 → 카피 프롬프트**(winning-style.ts, copywriter/index.ts): 밸런스게임 A/B(2개), 질문 1개, 가독성 2/3/4줄+첫줄 짧게, 두괄식, 공감(실패), 정보성=공유유도, 이모지 무영향.
- **1강 → 게이팅**(reach-health.ts): 수익화 팔로워 폴백 100→300.
- **1강 → 문서**(course-tactics.md): 사람 운영 규칙 전문(계정 생성·2FA·프로필·쿠팡 가입 등).
- **1강 → 대기(설계 필요)**: 재탕 빈도(쿠팡3일/일상7일/스하리1일) 자동화, 버티컬 알고리즘 vs 성별 게이팅 충돌, 수익화 물량.

## 소스 접근 메모
- 1강 영상: 네이버 카페 31672347 / article 9 (Vimeo id 1168694502, h=e4eb4db90f).
- 카페 자체 플레이어 = Vimeo 임베드. 각 강의 글에서 `player.vimeo.com/video/<id>?h=<hash>` 를 네트워크 탭에서 확인 → yt-dlp.
