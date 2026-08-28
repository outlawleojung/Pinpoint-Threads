---
title: "reply-composer"
pipelines: ["A"]
ai_model: "none"
tags: ["agent", "runtime-module", "commerce", "template", "legal"]
related: ["A-shopping", "legal-compliance"]
last_updated: "2026-08-28"
status: "draft"
---

# reply-composer

Pipeline A의 **고정 댓글**(자기 게시글에 다는 첫 댓글, 상단 고정 효과) 조립 모듈.
결정론적 로직. AI 미사용.

## 목적

발행할 본문 옆에 붙일 고정 댓글 텍스트를 4가지 실전 양식 중 선택·조립하여 반환.
링크 자동 프리뷰 억제, 공정위 필수 문구 강제.

## 입력 스펙

```typescript
interface ReplyComposeInput {
  deeplinkUrl: string;          // 쿠팡 파트너스 딥링크
  productName?: string;         // 양식 4에서만 사용
  accountId: string;            // 계정별 다변화 seed
  dayOfWeek: number;            // 요일별 다변화 seed
  variantOverride?: 1 | 2 | 3 | 4;  // 수동 지정 (테스트/재생성용)
}
```

## 출력 스펙

```typescript
interface ReplyComposeResult {
  text: string;                 // Threads reply 발행용 완성 텍스트
  variantUsed: 1 | 2 | 3 | 4;
}
```

## 로직

1. `variantOverride`가 있으면 그것 사용, 없으면 `(accountId + dayOfWeek)` 해시로 4개 양식 중 하나 결정 (안정적 다변화)
2. 선택된 양식 템플릿에 `deeplinkUrl`, `productName` 삽입
3. 공정위 문구 포함 여부 assert (없으면 자동 append)
4. 반환

## 4가지 양식 (사용자 실전 확보)

### 양식 1 — 캐주얼 반말 + [광고] 명시
```
[광고] 완전 급할 땐 이거 씀ㅋㅋ
➡️➡️{DEEPLINK}
"이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다"
```

### 양식 2 — 정보 안내형, 공정위 상단
```
이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
•••••••••••••••••••••••••••••••••••••••••••••••••••
🔽 정보는 아래 링크에! 🔽
❤️{DEEPLINK}❤️
```

### 양식 3 — 캐주얼 감성 + [광고] + 링크 반복
```
[광고] 주말에 이거만 한다 ㅋㅋㅋ
💕💕💕💕💕💕💕💕💕
{DEEPLINK}
{DEEPLINK}
💕💕💕💕💕💕💕💕💕
*이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.
```

### 양식 4 — 상품 소구형, 공정위 상단, 링크 반복
```
"이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다."
ㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡㅡ

🔽 {PRODUCT_NAME} 정보 🔽

❤️{DEEPLINK}❤️
❤️{DEEPLINK}❤️

안사도 되니까 구경만 해요💗
```

## 공통 하드 룰

- 공정위 문구는 반드시 포함 (스키마 검증)
- 이모지 3~5개 (양식별 고정)
- 브랜드명·가격·"쿠팡" 채널명 본문 절대 금지 (댓글에는 딥링크만)

## 실패 모드 & 폴백

- 공정위 문구 미포함 → 자동 append
- `productName` 미제공 상태에서 양식 4 선택 → 양식 1로 자동 폴백
- 딥링크 URL 형식 오류 → error throw (Publisher 발행 전 차단)

## 재시도 정책

이 모듈은 순수 함수 → 재시도 불필요.

## 관찰 지표

- 양식별 사용 분포 (계정별)
- 공정위 자동 append 발생률 (템플릿 결함 지표)

## 관련 이슈

- **자동 링크 프리뷰 이미지**: Threads가 URL 감지 시 상품 페이지 프리뷰를 자동 삽입. Publisher/Threads API에서 disable 방법 확인 필요. [A-shopping § 9.1](../../01-pipelines/A-shopping.md)
