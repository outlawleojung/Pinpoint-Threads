---
title: "reply-composer"
pipelines: ["A"]
ai_model: "claude-sonnet-5 (LLM_PROVIDER=anthropic)"
tags: ["agent", "runtime-module", "commerce", "template", "legal"]
related: ["A-shopping", "legal-compliance", "copywriter"]
last_updated: "2026-08-28"
status: "active"
---

# reply-composer

Pipeline A의 **고정 댓글**(자기 게시글에 다는 첫 댓글, 상단 고정 효과) 조립 모듈.

## 설계 (2026-08-28 재정의)

과거 4가지 실전 양식 랜덤 순환 방식은 폐기됨. 이유:
- 각 양식이 특정 상황·상품 톤에 맞춰져 있어 랜덤 선택 시 상품과 톤 불일치 잦음
- 예: 양식 1 "완전 급할 땐 이거 씀"이 가습기 같은 비긴급 상품에 부적합

**새 방식**: AI(Anthropic Sonnet)가 상품 + 본문 맥락 기반 **"툭 던지는 감초 톤" 리드 문장** 매번 생성.

## 목적

발행할 본문 옆에 붙일 고정 댓글 텍스트를 조립.
- AI 생성 리드 문장 (매번 새 문구, 상품·본문 연결)
- 딥링크 + 공정위 필수 문구는 결정론적 조립

## 사용자 방침

> "댓글은 상품에 맞게 광고 티 안 나게 그냥 툭 던지는 멘트로 가볍게 넣는 느낌.
>  크게 중요하지 않은 감초 같은 역할."

## 입력 스펙

```typescript
interface ReplyComposeInput {
  body: string;              // 이미 생성된 본문 (톤 컨텍스트)
  productName: string;
  productCategory?: string;
  deeplinkUrl: string;
  accountId: string;         // 페르소나 다변화 seed
  personaPrompt?: string;
}
```

## 출력 스펙

```typescript
interface ReplyComposeResult {
  text: string;   // 최종 조립 (리드 + 딥링크 + 공정위)
  lead: string;   // AI 생성 리드만 (디버깅용)
}
```

## 로직

1. Anthropic Sonnet에 system prompt (감초 톤 규칙) + user prompt (상품·본문) 전송
2. `{ lead: string }` JSON 응답 파싱 (extractJson으로 안전 파싱)
3. 최종 조립: `${lead}\n${deeplinkUrl}\n\n${LEGAL_DISCLAIMER}`

## 프롬프트 핵심 규칙

**허용:**
- 반말 + 인터넷 구어체
- 1문장, 15~50자
- 이모지 0~1개
- 어미: ~임 / ~네 / ~ㄹ 뻔 / ~였음 / ~인 거 실화? / ~이라니

**금지:**
- 브랜드·모델·가격·"쿠팡"·"파트너스"·"링크" 명시
- 강추·추천·가성비·필수템·후기·리뷰 어휘
- 명령·요청형 ("사세요", "확인해봐요")

**권장 예:**
- "책상 위에 하나 놓았을 뿐인데 은근 별세계임"
- "이거 없이 어떻게 살았는지 모르겠음"
- "무심코 산 건데 요즘 제일 잘한 일임"

## 실전 검증 결과 (2026-08-28)

| 본문 | 생성된 리드 | 평가 |
|---|---|---|
| 책상에 습도 96%라고 뜨는 거 보고 괜히 안심됨 | 숫자 하나에 이렇게 마음이 편해질 일임? | ✅ 본문 톤과 자연스레 이어짐 |
| 해변에 돌멩이 왜 이렇게 일렬로 놓여있냐 | 책상 위 물건들도 이거 하나 놓으니까 은근 줄 세운 느낌 남 | ✅ 이미지 오해 있어도 상품과 자연스레 연결 |

## 하드 룰

- 공정위 문구 필수: `이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.`
- 딥링크는 반드시 리드 문장 다음 줄
- 브랜드·가격 등 홍보 요소는 프롬프트로 강제 배제

## 실패 모드 & 폴백

- LLM 응답이 JSON 아님 → extractJson이 `{...}` 부분만 추출 시도
- 리드가 4~80자 범위 벗어남 → Zod 검증 실패 → 상위 catch에서 재시도 or fail
- LLM 호출 실패 (rate limit / network) → LLM Provider의 withRetry가 처리 (Gemini만)

## 재시도 정책

Reply Composer 자체는 재시도 로직 없음. Provider 레벨의 retry에 의존.

## 관찰 지표

- 리드 문장 평균 길이
- 리드에 금지 어휘 포함 발생률 (품질 지표)
- LLM 응답 시간 · 토큰 사용량

## 관련 문서

- [A-shopping](../../01-pipelines/A-shopping.md) — 파이프라인 전체
- [legal-compliance](../../04-safety/legal-compliance.md) — 공정위 문구
- [copywriter](../../09-agents/shared/copywriter.md) — 본문 생성 (컨텍스트 제공원)
