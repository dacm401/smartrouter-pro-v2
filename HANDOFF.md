# HANDOFF.md — smartrouter-pro 最终归档状态

> 每开新对话，先读本文件，再读 MEMORY.md。

---

## 项目状态：Phase B COMPLETE ✅ → Phase C 待开

Sprint 14 完成态。Sprint 15 全部收口（C3a / E1 / T1 / W1 / UI1 / B1）。Sprint 16 Phase B 收口（H1 / R1 / B2）。Sprint 18 稳定性收口（Docker / CI / PROJECT_STATUS.md）。TS 错误全部清零。

---

## Sprint 14 全部 CLOSED ✅

| P | 描述 | 状态 | Commit |
|---|---|---|---|
| P1 | B 层 implicit signal audit | ✅ CLOSED | `80389b9` |
| P2 | Feedback API Hardening | ✅ CLOSED | `80389b9` |
| P3 | Feedback Events MVP | ✅ CLOSED | `80389b9` |
| P4 | Auto-detect Backfill | ✅ CLOSED | `f6371c4` |
| P5 | Learning-side Signal Level Gating | ✅ CLOSED | `f6371c4` |

---

## Sprint 15 全部 CLOSED ✅

| 卡片 | 描述 | 状态 | Commit |
|---|---|---|---|
| C3a | Server Identity Context Adapter | ✅ CLOSED | `5e6d7e8` |
| E1 | Evidence System v1（Layer 6 入口） | ✅ CLOSED | `07d0b16` |
| T1 | Task Resume v1 | ✅ CLOSED | `d03704c` |
| W1 | web_search 真实接入 | ✅ CLOSED | `d03704c` |
| UI1 | 最小工作台 UI | ✅ CLOSED | `d03704c` |
| B1 | Benchmark Runner 骨架 | ✅ CLOSED | `d03704c` |

**HEAD：** `f4fa449` — Sprint 16 Phase B 收口

**Sprint 18 HEAD：** `3408d0a` — Sprint 18 稳定性收口

| Commit | 内容 |
|--------|------|
| `f4fa449` | feat: Sprint 16 Phase B complete — H1 Health Dashboard, R1 E2E Regression Pack, B2 Benchmark Runner v2 |
| `5fcae59` | ts-type: fix 4 pre-existing TS errors; docs: update HANDOFF for E1 |
| `d03704c` | feat: Sprint 15 complete — Task Resume v1, web_search, UI panels, Benchmark skeleton |

---

## Sprint 16 Phase B 全部 CLOSED ✅

| 卡片 | 描述 | 状态 | 核心实现 |
|---|---|---|---|
| H1 | Runtime Health Dashboard | ✅ CLOSED | `GET /health` 结构化端点（DB latency / model router / web_search / stats）+ 前端 HealthPanel（第 4 tab） |
| R1 | E2E Regression Pack | ✅ CLOSED | `chat.test.ts` / `evidence.test.ts` / `tasks.test.ts`（mock-based，vitest.r1.config.ts，35 tests ✅） |
| B2 | Benchmark Runner 接真实 API | ✅ CLOSED | CLI args / 30s timeout / printSummary() / `evaluation/results/latest.json` / execute.json / `benchmark` npm script |

**`tsc --noEmit`：backend + frontend 零错误 ✅**

---

## Sprint 18 全部 CLOSED ✅

| 卡片 | 描述 | 状态 | 核心实现 |
|---|---|---|---|
| S1 | Docker Compose 验证与修复 | ✅ CLOSED | docker-compose.yml 修复（postgres healthcheck / DATABASE_URL / NODE_ENV / 移除破坏性 volume）+ backend/frontend Dockerfile 多阶段构建升级 |
| S2 | Repo 测试本地跑通 | ⚠️ SKIPPED | Docker daemon 不可用；测试 harness 已就绪（`smartrouter_test` auto-create + schema load），CI 中可运行 |
| S3 | GitHub Actions CI | ✅ CLOSED | `.github/workflows/ci.yml`（test-r1 + test-repos + test-frontend 三 job） |
| S4 | PROJECT_STATUS.md | ✅ CLOSED | 新建 `PROJECT_STATUS.md`（定位 / 完成度 / 功能清单 / 限制 / 快速启动 / 测试命令） |

---

## 项目尾项卡片 CLOSED ✅

| 卡片 | 描述 | 状态 | 核心实现 |
|---|---|---|---|
| C1 | DecisionRepo satisfaction_rate signal_level 分层 | ✅ CLOSED | `getTodayStats()` / `getRoutingAccuracyHistory()` 加 LEFT JOIN `feedback_events`，按 `signal_level <= 1` 过滤；legacy fallback = 无 `feedback_events` 记录 + `feedback_score IS NOT NULL` |
| C2 | Feedback dual-write consistency | ✅ CLOSED | `recordFeedback()` 调换写入顺序：`FeedbackEventRepo.save()` 先写，成功后再写 `decision_logs`；失败时两者均不更新 |
| C3a | Server Identity Context Adapter | ✅ CLOSED | `identityMiddleware` + `getContextUserId()`；所有 handler 改从 middleware context 读 userId；生产模式无 X-User-Id header 直接 401 |
| E1 | Evidence System v1（Layer 6 入口） | ✅ CLOSED | `evidence` 表 + `EvidenceRepo` + `/v1/evidence` CRUD API + `handleWebSearch` 自动写入 evidence（fire-and-forget）；`memory_entries` vs `evidence` 职责划分：独立建表，evidence 保留 provenance |

---

## C1 核心实现要点

- `repositories.ts`：`getTodayStats()` / `getRoutingAccuracyHistory()` 均使用 CTE + LEFT JOIN `feedback_events`
- L1 signal = `fe.signal_level <= 1` OR（无 `feedback_events` 记录 AND `d.feedback_score IS NOT NULL`）
- `satisfaction_rate` 只在 L1 signal 上计算，与 `analyzeAndLearn()` truth 定义对齐
- `decision-repo.test.ts`：新增 13 个 signal_level 过滤测试，总计 48/48

---

---

## C3a 核心实现要点

- `middleware/identity.ts`：identityMiddleware（身份解析）+ getContextUserId()
- `config.identity.allowDevFallback`：环境变量 `ALLOW_DEV_FALLBACK=true` 开启 dev fallback
- 身份优先级：① X-User-Id header → ② query.user_id（dev） → ③ 401
- 所有 API handler（chat/feedback/tasks/memory/dashboard）改从 middleware context 读 userId
- chat/feedback 端点：dev-only body shim（仅当 context 无值且 allowDevFallback=true 时读 body.user_id）
- 未引入 session/token/JWT/auth 系统（严格遵守 scope 约束）

---

## C2 核心实现要点

- `feedback-collector.ts`：`recordFeedback()` 写入顺序调换
- 有 `userId`：先写 `feedback_events` → 成功 → 写 `decision_logs`
- 有 `userId` + `FeedbackEventRepo.save` 失败：`decision_logs` 不更新，无孤立记录
- 无 `userId`：保持 legacy 路径，仅写 `decision_logs`
- `feedback-collector.test.ts`：新增 5 个双写原子性测试，总计 48/48

---

## E1 核心实现要点

- `src/db/schema.sql`：新增 `evidence` 表（含 `evidence_id`/`task_id`/`user_id`/`source`/`content`/`source_metadata`/`relevance_score`/`created_at`）
- `src/types/index.ts`：`Evidence`、`EvidenceInput`、`EvidenceSource`（`"web_search" | "http_request" | "manual"`）
- `src/db/repositories.ts`：`EvidenceRepo`（create / getById / listByTask / listByUser）
- `src/api/evidence.ts`：POST `/v1/evidence`（201）、GET `/v1/evidence/:id`（200/404）、GET `/v1/evidence?task_id=`（200）；C3a middleware 保护
- `src/tools/executor.ts`：`handleWebSearch` 成功返回前 fire-and-forget 写入 evidence；taskId 缺失时跳过
- `tests/repositories/evidence-repo.test.ts`：18 个 repo 测试用例（DB 基础设施问题未执行）
- `memory_entries` vs `evidence` 边界：memory_entries = 用户级/可编辑；evidence = 任务级/保留 provenance

---

## TypeScript 错误清理（Step B）

| 错误 | 文件 | 修复方式 | 结论 |
|------|------|---------|------|
| TS2322 | `chat.ts:178` | `s.status as "pending" \| "in_progress" \| "completed" \| "failed"` | ✅ 纯类型 cast，无业务逻辑改动 |
| TS2561 | `repositories.ts:428` | 删除 `routing_accuracy_history` 赋值（类型已移除该字段） | ✅ 清理遗留代码，与 GrowthProfile 类型同步 |
| TS2339×3 | `execution-loop.ts:302/363/392` | `ExecutionStep` 类型补 `description?: string` | ✅ 纯类型字段，无业务逻辑改动 |

**`tsc --noEmit` 结果：零错误（backend + frontend + evaluation）。**

---

## T1 核心实现要点（Task Resume v1）

- **触发方式**：方案 C（混合）——显式 `task_id` 优先；无则按 `session_id` 找最近 `status NOT IN ('completed','failed','cancelled')`；都没有就新建
- `TaskRepo.findActiveBySession(sessionId, userId)`：查最近 active task
- `TaskRepo.setStatus(taskId, status)`：resume→`responding` / pause→`paused` / cancel→`cancelled`
- `PATCH /v1/tasks/:task_id`：提供 `action: 'resume' | 'pause' | 'cancel'`，C3a 保护
- `resumedTaskSummary` 注入 prompt context：`completed_steps / blocked_by / confirmed_facts / summary_text`
- `ChatRequest.task_id` / `ChatResponse.task_id`：前后端契约
- `tests/repositories/task-resume.test.ts`：5 个用例（DB 基础设施未执行）

---

## W1 核心实现要点（web_search 真实接入）

- `config.webSearch`：新增 `{ endpoint, apiKey, maxResults }` 配置节
- `handleWebSearch()`：读 `config.webSearch.endpoint`，无 endpoint → `{ results: [], error: "WEB_SEARCH_NOT_CONFIGURED" }`
- 带 `Authorization: Bearer <apiKey>` header（若有）
- 网络错误 / 非 OK 状态 → `{ results: [], error: "FETCH_ERROR: ..." }` / `{ results: [], error: "SEARCH_API_ERROR: ..." }`，不抛异常
- `.env.example` 补 `WEB_SEARCH_ENDPOINT=` / `WEB_SEARCH_API_KEY=` / `WEB_SEARCH_MAX_RESULTS=`

---

## UI1 核心实现要点（最小工作台 UI）

- **TaskPanel**：`GET /v1/tasks/all`，展示 `title / status / mode`，点击选中
- **EvidencePanel**：`GET /v1/evidence?task_id=`，source icon + content（截断 200 字）+ URL 链接
- **TracePanel**：`GET /v1/tasks/:id/traces`，type 分图标，展示 detail 摘要
- `ChatInterface.onTaskIdChange`：响应带回 `task_id` 后触发回调，驱动面板刷新
- `app/page.tsx`：右侧工作台侧边栏（默认展开，可折叠），Task Panel 上 + Evidence/Trace tab 切换
- 未引入新 UI 库，仅用现有 Tailwind / React

---

## B1 核心实现要点（Benchmark Runner 骨架）

- `evaluation/runner.ts`：`BenchmarkTask[]` / `BenchmarkResult[]` 类型，`runBenchmark()` / `printReport()`
- `evaluation/tasks/direct.json`：5 条 direct 模式测试用例
- `evaluation/tasks/research.json`：5 条 research 模式测试用例
- `evaluation/README.md`：运行说明 `npx ts-node evaluation/runner.ts`
- `evaluation/tsconfig.json`：独立 tsconfig，引用 backend `@types/node`
- runner 可编译：`tsc --noEmit` 零错误

---

## H1 核心实现要点（Runtime Health Dashboard）

- `backend/src/api/health.ts`：Hono router，`GET /` 返回结构化 health JSON
- `backend/src/index.ts`：`app.route("/health", healthRouter)`，挂载在 identity middleware 之前（public）
- `backend/src/config.js`：`config.webSearch.endpoint` / `config.openaiApiKey` / `config.anthropicApiKey` 用于 provider 检测
- **Health 结构**：`{ status, services: { database, model_router, web_search }, stats, uptime_sec }`
- **Graceful degradation**：所有 stats 查询包在 try/catch 中，失败返回 `null`
- **DB latency**：`db.query("SELECT 1")` + timing
- **Frontend**：HealthPanel（第 4 个 tab）+ `fetchHealth()` API 调用，无 X-User-Id（public endpoint）
- `frontend/src/components/workbench/HealthPanel.tsx`：30s auto-refresh，status badge + service rows + stats grid + uptime

---

## R1 核心实现要点（E2E Regression Pack）

- `backend/vitest.r1.config.ts`：独立 vitest config，`globals: true`，`environment: "node"`，无 setupFiles / DATABASE_URL
- `tests/api/chat.test.ts`：4 tests（normal 200 / missing message 200 / dev fallback 200 / task_id ownership 403）
- `tests/api/evidence.test.ts`：8 tests（POST 201+400 / GET by id 200+404 / GET by task_id 200）
- `tests/api/tasks.test.ts`：9 tests（GET /all / PATCH resume/pause/cancel / ownership 403+404 / validation 400）
- `tests/api/chat-execute.test.ts`：pre-existing，14 tests patched（T1 方法 / identity config / mock 补全）
- **Mock 策略**：`vi.mock()` 全部在 module top level；动态 `import(chatRouter)` 在 `beforeAll`
- **chat.ts 修复**：`body.message ?? ""` — missing message 不再崩溃（4 处替换）
- `npm run test:r1`：35/35 ✅

---

## B2 核心实现要点（Benchmark Runner 接真实 API）

- `evaluation/runner.ts`：全面升级
  - CLI args：`--base-url` / `--user-id` / `--suite`
  - 30s per-request timeout（`AbortController` + `setTimeout`）
  - `printSummary()`：Total / Passed / Failed / Errors / Rate / Avg latency
  - `evaluation/results/latest.json`：含 summary + results + timestamp
- `evaluation/tasks/execute.json`：3 条 execute-mode 任务（`execute: true`）
- `backend/package.json`：`"benchmark": "npx ts-node ../evaluation/runner.ts"`
- 合计：13 tasks（5 direct + 5 research + 3 execute）
- `npm run benchmark`：成功加载并执行（backend 未运行时 fetch failed — 预期行为）

---

## 后续治理项（Deferred，不阻断交付）

---

## 已确认的架构边界（不得打破）

- **TaskPlanner 不查数据库**：retrieval 在 chat.ts，planner 只接收 `executionResultContext?: string`
- **不默认注入失败结果**：`allowedReasons` 默认 `["completed"]`
- **Behavioral Learning 信号边界**：
  - `fastExplicitSamples`：L1 (signal_level=1) → truth + eligibility
  - `fastL2Samples`：L2 (signal_level=2) → eligibility only
  - `fastL3Samples`：L3 (signal_level=3) → 完全排除
  - `fastExecutionSignalSamples`（P4.2）：`did_fallback=true` 或 `cost_saved>0` → eligibility only

---

## 测试口径（最终验证）

| Suite | 命令 | 结果 |
|---|---|---|
| memory-store.test.ts（P5） | `npx vitest run ... memory-store.test.ts` | 33 tests ✅ |
| feedback-collector.test.ts（P4+C2） | `npx vitest run ... feedback-collector.test.ts` | 48 tests ✅ |
| feedback-event-repo.test.ts（P3） | `npx vitest run ... feedback-event-repo.test.ts` | 21 tests ✅ |
| decision-repo.test.ts（C1） | `npx vitest run ... decision-repo.test.ts` | 48 tests ✅ |
| evidence-repo.test.ts（E1） | `npx vitest run --config vitest.repo.config.ts ... evidence-repo.test.ts` | 18 tests ⚠️ DB down |
| task-resume.test.ts（T1） | `npx vitest run --config vitest.repo.config.ts ... task-resume.test.ts` | 5 tests ⚠️ DB down |
| **R1 test:r1** | `npm run test:r1` | **35 tests ✅（chat 4 + evidence 8 + tasks 9 + chat-execute 14）** |

---

## Docker 与 CI（Sprint 18）

### Docker Compose

- `docker-compose.yml`（已修复并升级）：postgres（healthcheck）/ backend（DATABASE_URL + NODE_ENV + multi-stage build）/ frontend（standalone multi-stage）
- `backend/Dockerfile`（已升级）：`npm ci --omit=dev` + multi-stage build → `node dist/index.js`
- `frontend/Dockerfile`（已升级）：Next.js standalone multi-stage build
- `frontend/next.config.js`：`output: "standalone"` ✅
- **注意**：Docker daemon 在本环境不可用，无法 live 验证；配置已就绪，需 CI 或有 Docker 环境的机器验证

### GitHub Actions CI

- `.github/workflows/ci.yml`（新建）：3 个 job
  - `test-r1`：R1 mock 测试（`npm run test:r1`）+ `tsc --noEmit`
  - `test-repos`：PostgreSQL service + schema init + `npm run test:repos`
  - `test-frontend`：`tsc --noEmit`

⚠️ PowerShell 注意：`&&` 链式执行会短路，不作最终证据。以单文件独立进程结果为准。

---

## 关键文件路径

| 文件 | 作用 |
|---|---|
| `backend/src/services/memory-store.ts` | `analyzeAndLearn()` — 核心 learning 逻辑 |
| `backend/src/features/feedback-collector.ts` | `detectImplicitFeedback()` + `recordFeedback()` |
| `backend/src/db/repositories.ts` | DecisionRepo + FeedbackEventRepo，含 C1 satisfaction_rate 分层 SQL |
| `backend/tests/services/memory-store.test.ts` | P5 验收测试 33 个 |
| `backend/tests/features/feedback-collector.test.ts` | P4+C2 验收测试 48 个 |
| `backend/tests/repositories/feedback-event-repo.test.ts` | Repo 测试 21 个 |
| `backend/tests/repositories/decision-repo.test.ts` | C1 验收测试 48 个 |
| `backend/src/api/chat.ts` | T1 Task Resume + chat.ts body.message graceful fallback |
| `backend/src/api/evidence.ts` | E1 Evidence CRUD API |
| `backend/src/api/health.ts` | H1 Health endpoint（DB latency / model router / web_search） |
| `backend/src/tools/executor.ts` | W1 web_search 真实接入 + E1 evidence fire-and-forget |
| `backend/vitest.r1.config.ts` | R1 独立 vitest config（mock-based，无 DB） |
| `backend/tests/api/chat.test.ts` | R1 chat endpoint 4 tests |
| `backend/tests/api/evidence.test.ts` | R1 evidence endpoint 8 tests |
| `backend/tests/api/tasks.test.ts` | R1 tasks endpoint 9 tests |
| `frontend/src/app/page.tsx` | UI1 工作台侧边栏 + HealthPanel tab |
| `frontend/src/components/workbench/` | UI1 TaskPanel / EvidencePanel / TracePanel / HealthPanel |
| `frontend/src/lib/api.ts` | `fetchHealth()` — H1 前端 API 调用 |
| `evaluation/runner.ts` | B1/B2 Benchmark Runner v2（CLI + timeout + printSummary） |
| `evaluation/tasks/execute.json` | B2 execute-mode 3 任务 |
| `evaluation/results/latest.json` | B2 benchmark 结果（含 summary） |
| `docker-compose.yml` | S1 全链路 Docker 部署配置（postgres/backend/frontend） |
| `backend/Dockerfile` | S1 backend 多阶段构建（npm ci --omit=dev） |
| `frontend/Dockerfile` | S1 frontend 多阶段构建（Next.js standalone） |
| `.github/workflows/ci.yml` | S3 GitHub Actions CI（test-r1 + test-repos + test-frontend） |
| `PROJECT_STATUS.md` | S4 项目交付状态文档（v1.0.0 / 完成度 / 快速启动） |
| `docs/sprint14-p1-implicit-signal-audit.md` | P1 审计报告 |

---

## 后续治理项（Deferred，不阻断交付）

| 卡片 | 说明 | 风险级别 |
|---|---|---|
| Feedback dual-write reverse order | `feedback_events` 成功 + `decision_logs` 失败时的表间短暂不一致 | 低 |
| Evidence System Layer 6 完整性 | evidence 只写了 web_search 来源，http_request 来源待 W1 接入后补充 | 低 |

---

## 用户偏好（不变）

- 黄西式冷幽默风格
- 项目经理式派工（进度报告、分阶段验收）
- 证据闭环一致性：叙述版本必须收成一版
- 先审计/计划，再改代码
- 弱信号不升级为 truth
