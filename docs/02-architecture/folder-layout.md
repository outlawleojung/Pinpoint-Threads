---
title: "src 폴더 구조"
tags: ["architecture", "folder-layout"]
related: ["tech-stack"]
last_updated: "2026-08-28"
status: "draft"
---
# src 폴더 구조

_아직 미작성. 브레인스토밍 진행하며 채워짐._

## 현재 구조
- src/adapters/{anthropic,commerce,telegram,threads,media}
- src/config/{env,logger}
- src/db/prisma
- src/queues/{connection,queues}
- src/state/post-state-machine
- src/pipeline/workers
- src/services/approval-service
- src/{index,worker,bot}.ts
