---
title: "로컬 개발 부팅"
tags: ["infrastructure", "local-dev"]
related: ["database", "deployment"]
last_updated: "2026-09-09"
status: "active"
---
# 로컬 개발 부팅 가이드

## 설치 및 정적 검증

검증 환경: Node.js 22.21.1, pnpm 9.12.1. 의존성은 `pnpm-lock.yaml`로 관리한다. npm과 pnpm 설치를 혼용하지 않는다.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test:copy
```

`typecheck`와 `build`는 먼저 현재 `prisma/schema.prisma`로 Prisma Client를 생성한다. 스키마 변경 후 구형 Client 때문에 타입 오류가 발생하는 것을 방지한다. 이 생성 작업은 로컬 파일만 갱신하며 DB 마이그레이션을 실행하지 않는다.

타입 검사는 `tsconfig.json`에 포함된 전체 `src/**/*.ts`가 대상이다. `test:copy`는 모델 응답을 대체한 7개 오프라인 회귀 테스트이며 DB·실발행을 호출하지 않는다. 생성된 `dist`와 Prisma Client는 커밋하지 않는다.

`pnpm lint`는 ESLint 설정 파일이 아직 없어 별도 정비가 필요하다. 타입 검사·빌드 통과가 lint나 운영 환경의 정상 동작까지 보장하지는 않는다.
