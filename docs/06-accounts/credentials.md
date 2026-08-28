---
title: "토큰 관리"
tags: ["accounts", "credentials", "security"]
related: ["threads"]
last_updated: "2026-08-28"
status: "draft"
---
# 토큰 관리

_아직 미작성. 브레인스토밍 진행하며 채워짐._

## 원칙
- 실제 토큰은 .env / DB에만 (문서에 절대 금지)
- Long-lived Access Token 60일 만료 → 자동 갱신 워커
