---
title: 정정 학습 루프 + 생성 품질 검사 (Correction-Learning Loop)
date: 2026-09-09
status: draft
related:
  - ../../STATE.md
  - ../../09-backlog/2026-09-08-shopping-profit-audit.md
---

# 정정 학습 루프 + 생성 품질 검사

## 1. 목표 & 완료 기준

**완료 기준을 "생성 성공"이 아니라 "사용자가 수정 없이 승인할 수 있는 비율"로 재정의한다.**

북극성 지표(3개를 함께 본다 — 폐기 착시 방지):
- **무수정 승인율**: 카드가 정정 0회로 승인된 비율.
- **승인까지 사용자 작업 시간**: 카드당 정정 횟수·소요.
- **폐기율**: 많이 버려서 승인분만 좋아 보이는 착시 차단. 실제로 사용자 시간이 줄었는지 확인.

## 2. 범위

- **1차: 쇼핑(Line A) + 일상(Line C).** 정정이 여기 몰림.
- 스하리(Line B)는 자체 다양성 시스템 있으니 후순위.
- 생성 품질 개선과 학습 루프를 **같은 작업 범위**로 진행.

## 3. 순서 (2트랙, 순차)

**Track 1(먼저): 생성 품질 직접 개선** → **Track 2(이어서): 정정 학습 루프.**
원칙: **이미 확인된 공통 문제는 프롬프트/검증에서 직접 잡는다. 사용자가 반복 정정해서 가르치게 만들지 않는다.**

---

## Track 1 — 생성 품질 검사

강한 마무리·특정 형식을 **강제하지 않는다** (모든 글에 강한 마무리 강제 → 또 상투구 유발). 대신 **검사**한다:

- **본문**: 구체적인 매력이 살아 있는가? 끝부분이 앞말을 반복하거나 힘을 빼지 않는가?
- **댓글([광고] 고정댓글)**: 본문을 되풀이하지 않고 상품 확인으로 자연스럽게 연결되는가?
- **공통**: 없는 체험·인기·품절·효능을 덧붙이지 않았는가? (미확인 디테일 = 생략 또는 불확실성 유지)

구현: factCheck(또는 별도 리뷰 스텝)에 위 3검사를 추가. 실패 시 재생성. "마무리 훅 필수" 같은 강제 규칙은 넣지 않는다.

댓글 반복 문제: reply-composer에 다양성 풀 + "본문 되풀이 금지·상품확인 연결" 검사.

## Track 2 — 정정 학습 루프

### A. 캡처
승인 카드에 텔레그램 **답장**으로 자유 정정 ("옆사람이야" / "동전 빼" / "마무리 밋밋해"). 봇이 답장 → 해당 postId 연결.

### B. 즉시 적용 (규칙 승인 안 기다림)
- 정정을 **하드 제약**으로 넣어 **카드 즉시 재생성·재전송**. "옆사람이야" 하나 고치는 데 규칙 승인 대기 X (편집 부담 방지).
- **재생성은 표현만 바꾸는 게 아니라 정정을 실제 반영**한다 (현재 방식 폐기).
- **원본 재확인**: 캡션만으로 부족. **원본 캡션(InboundLink) + 이미지/영상 설명 + 이 게시물 누적 정정**을 함께 읽는다. 확인할 수 없는 디테일은 **생략하거나 불확실성을 남긴다.**
- ※ 정정 학습이 **영상 이해 자체를 대체하지 못한다.** 영상 움직임 이해는 별도 과제(대표 프레임 다장·자막·음성)로 남는다.

### C. 저장
- **최종카피 = 사용자가 "발행 승인"한 버전.** 재생성 직후 문구는 아직 정답이 아니므로 저장하지 않는다.
- 보존: `{상품/장면, 원본카피, 정정지시(들), 본문·댓글, 승인 최종본, category, 정정 이력}`.
- 재사용은 **승인된 결과를 우선**한다.

### D. 자동분류 (보수적)
정정을 LLM이 분류하되 **과대 일반화 금지**:
- **사실 정정** (예: "옆사람" = 장면 사실) — 이 게시물 한정, 규칙 아님.
- **표현 선호 / 초점 변경** (예: "동전 빼" = 이 글의 초점 변경일 수 있음) — 곧바로 "한국 콘텐츠 동전 금지" 같은 **전역 규칙으로 확대하지 않는다.**
- **규칙 후보**만 별도로 뽑고, 규칙이면 **적용 범위**(전역 / 카테고리 / 해외상품 / 장면유형)를 **좁게** 추출.
- 규칙 승인은 **비동기** — 카드 수정과 분리. 사용자가 "이거 규칙 등록?" 승인해야 규칙 저장소에 들어감.

### E. 재사용 (= 카피 개선)
생성 시 주입:
1. 이 상품/장면 **범위에 맞는 등록 규칙**.
2. **유사 과거 정정 few-shot** ("비슷한 케이스에서 이렇게 고쳤음").
→ 같은 실수 반복 차단 → 무수정 승인율↑.

### 버전 / 멱등 (중요)
- 카드 재전송 시 **같은 게시물 이력을 유지**한다.
- **이전 카드의 승인 버튼으로 오래된 문구가 발행되지 않게** 한다 (재전송 시 이전 카드 승인 무효화 / 최신 버전만 발행 가능).

---

## 4. 데이터 모델 (초안)

- **CopyCorrection**: `postId, accountId, contentKind(SHOPPING|DAILY), productType/sceneType, originalBody, correctionText, resultingBody, classifiedType(fact|preference|focus), approvedFinal(bool), createdAt`.
- **CopyRule**: `id, ruleText, scope(global|category|foreign|sceneType), scopeKey, sourceCorrectionId, approved(bool), createdBy, createdAt`.
- **Post** 확장: `cardVersion(int)`, `correctionCount(int)`, `approvedBodyVersion`.
- **승인 지표**: 카드별 정정 횟수·소요 시간·폐기 여부 집계.

## 5. 미해결 / 다음
- **영상 이해**: 이 스펙이 대체하지 않음. 대표 프레임 다장·자막·음성 추출은 별도 스펙.
- 상품 매칭 사각(해외·명품 쿠팡 부재)은 별도.
- 스하리(Line B) 적용은 후순위.

## 6. 열린 질문
- 규칙 저장소 vs 프롬프트 직접 주입의 경계(규칙이 많아지면 프롬프트 비대) — 범위 매칭 RAG로 상위 N개만 주입?
- "발행 승인 버전"만 저장 시, 승인 전 여러 정정의 이력도 학습에 쓸지(정정 지시 자체가 신호).

---

## 7. 구현 계획 확정 (2026-09-16)

### 7.1 현재 구현 상태 (실측)
- 성과 피드백 루프(scorer·copy-learning·propagation)는 구현·**스하리에만 연결**. 쇼핑/일상 학습은 표본 대기로 미연결.
- **정정 학습 루프는 통째로 미구현** — CopyCorrection·CopyRule 모델 없음. 사용자의 반복 정정이 어디에도 안 쌓임. ← 본 스펙이 채운다.
- Track 1(생성 품질 검사)은 오늘까지 상당 부분 선반영됨: winning-style 실측 승자/패자 대비, factCheck 개인정보·사실검사, 소장각 상투마무리 지양. → Track 1 은 factCheck에 "마무리 힘빼기·본문 되풀이" 검사 소폭 추가만 하고, **주력은 Track 2**.

### 7.2 데이터 모델 (실제 스키마 기준 잠금)
```prisma
model CopyCorrection {
  id               String   @id @default(cuid())
  postId           String
  post             Post     @relation(fields: [postId], references: [id], onDelete: Cascade)
  accountId        String
  contentKind      PostKind
  productType      String?  // 상품 카테고리 (쇼핑)
  sceneType        String?  // 장면 유형 (일상)
  originalBody     String   @db.Text
  correctionText   String   @db.Text
  resultingBody    String?  @db.Text
  classifiedType   String?  // fact | preference | focus
  approvedFinal    Boolean  @default(false)
  createdAt        DateTime @default(now())
  @@index([contentKind, createdAt])
  @@index([postId])
}

model CopyRule {
  id                 String   @id @default(cuid())
  ruleText           String   @db.Text
  scope              String   // global | category | foreign | sceneType
  scopeKey           String?
  sourceCorrectionId String?
  approved           Boolean  @default(false)
  createdAt          DateTime @default(now())
  @@index([scope, approved])
}
// Post 확장(추가 전용·nullable/default): cardVersion Int @default(0), correctionCount Int @default(0), approvedCardVersion Int?
// + relation: corrections CopyCorrection[]
```

### 7.3 단계 (각 단계 실측 검증 후 다음 · execute-don't-gate)
1. **마이그레이션 + 캡처 + 즉시 재생성 + 카드 버전 멱등**
   - `prisma db push`(추가 전용·무손실) + `prisma generate`(봇 DLL 락 시 일시정지 후).
   - 승인 카드에 텔레그램 **답장** → 그 postId의 CopyCorrection 저장 → 정정을 **하드 제약**으로 카드 재생성·재전송 (규칙 승인 대기 X).
   - `cardVersion++`; 승인 콜백에 버전 실어 **옛 카드 승인은 무효**(최신 버전만 발행).
   - 검증: 테스트 카드에 "옆사람이야" 답장 → 정정 반영된 새 카드, 옛 승인 버튼 dead 확인.
2. **승인본 저장**: 승인 시 그 버전의 body를 CopyCorrection.resultingBody + approvedFinal=true. 검증: 승인 후 DB 확인.
3. **재사용(핵심)**: 생성 시 같은 contentKind+productType/sceneType의 과거 승인 정정을 few-shot 주입(generateBody·generateDailyBody). 검증: 과거 정정한 유형 재발행 → 같은 실수 안 나옴.
4. **비동기 규칙 승격**: 반복 정정만 좁은 scope로 CopyRule 후보 → 사용자 승인 시 저장·주입.

### 7.4 리스크
- **공유 DB(네이버 세션)**: db push 는 schema.prisma 전체 동기화라, push 전 schema 가 DB 와 일치하는지 확인(추가 전용이라 drop 위험 낮음). generate 는 봇 실행 중 DLL 락(EPERM) 가능 → 필요 시 봇 잠깐 정지.
- 과대 일반화 금지(§D): 정정을 즉시 전역 규칙화하지 않음. 1·2·3단계는 "이 유형 한정" few-shot, 규칙화는 4단계에서 사용자 승인 하에만.
