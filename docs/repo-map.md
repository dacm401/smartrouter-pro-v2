# Repo Map

## Backend Key Areas

### API Routes
- `src/api/chat.ts` — POST /api/chat
- `src/api/tasks.ts` — task list/detail/summary/traces routes
- `src/api/memory.ts` — Memory v1 CRUD: POST/GET/PUT/DELETE /v1/memory

### Services
- `src/services/prompt-assembler.ts` — prompt assembly for direct/research modes
- `src/services/memory-store.ts` — memory storage for future Memory v1
- `src/services/context-manager.ts` — context compression and message assembly
- `src/services/memory-retrieval.ts` — Memory v2: retrieval pipeline, scoring, category-aware formatting
- `src/services/task-planner.ts` — decomposes goals into ExecutionPlan via Function Calling (Sprint 05 EL-002)
- `src/services/execution-loop.ts` — ordered step execution with tool_call/reasoning/synthesis (Sprint 05 EL-003)
- `src/services/execution-loop.ts` (guardrail) — tool-level HTTP/web guard policies (Sprint 05 EL-004)
- `src/services/execution-result-formatter.ts` — formats ExecutionResultRecord rows for planner context (Sprint 08 RR-002)
- `src/services/trace-formatter.ts` — ExecutionLoop trace → human-readable summaries (Sprint 06 TA-004)
- `src/router/router.ts` — model routing and intent classification
- `src/models/model-gateway.ts` — model call orchestration
- `src/logging/decision-logger.ts` — decision logging (verified 27/27/27 aligned — ER-001)
- `src/features/learning-engine.ts` — learning from interactions (stub)

### Repositories / Data Access
- `src/db/repositories.ts` — TaskRepo, DecisionRepo, MemoryRepo, GrowthRepo, MemoryEntryRepo, ExecutionResultRepo
  - `MemoryEntryRepo`: create, getById, list, update, delete, getTopForUser
  - `memory_entries` table: user-scoped, supports preference/fact/context/instruction categories
  - Retrieval layer (Sprint 04 MR-001/002/003): `src/services/memory-retrieval.ts` wraps `getTopForUser()` with scoring + formatting
  - `ExecutionResultRepo` (Sprint 07 ER-002/003): save, getByTaskId, listByUser
  - `execution_results` table: JSONB steps_summary, TEXT[] memory_entries_used, indexed by user_id + task_id

### Docs
- `docs/current-sprint.md` — active sprint
- `docs/sprint-01-review.md` — sprint 01 retrospective
- `docs/next-sprint-proposal.md` — next sprint direction
- `docs/dev-rules.md` — development conventions
- `docs/backlog.md` — known issues
- `docs/task-cards/` — feature and cleanup cards

## Runtime Flow Overview

Full runtime flow documented in: **`docs/runtime-flow.md`**

Brief summary:

```
POST /api/chat
  → chat.ts: parse request, create task record
  → router.ts: classify intent + complexity, select model
  → MemoryEntryRepo.getTopForUser() — fetch candidate pool (config-gated)
  → runRetrievalPipeline() — Sprint 04 MR-001/003: score + filter (v2 only)
  → buildCategoryAwareMemoryText() — Sprint 04 MR-002: category-grouped formatting
  → prompt-assembler.ts: assemble system prompt by mode + taskSummary injection
  → context-manager.ts: compress history, inject system prompt
  → model-gateway.ts: call selected model
  → quality-gate.ts: fast-path quality check + fallback if needed

  (execute mode — body.execute === true)
  → ExecutionResultRepo.listByUser() — Sprint 08 RR-003: recent results for planner context
  → formatExecutionResultsForPlanner() — format as text block
  → taskPlanner.plan(executionResultContext) — decompose goal into ExecutionPlan
  → executionLoop.run() — Sprint 05 EL-003: execute plan step by step
  → ExecutionResultRepo.save() — Sprint 07 ER-003: persist result (fire-and-forget)
```
  → decision-logger.ts: write decision trace (known SQL bug — non-blocking)
  → learning-engine.ts: implicit feedback + memory learning (fire-and-forget)
  → TaskRepo: write execution stats + 3 traces (fire-and-forget)
  → chat.ts: return { message, decision }
```

See **`docs/runtime-flow.md`** for the complete step-by-step walkthrough, file map, data touchpoints, and known quirks.

## Notes
- update this file whenever major modules are moved
- backend runs in Docker container: smartrouter-pro-backend-1
- backend port: 3001
- actual chat endpoint is /api/chat (not /v1/chat)
- task list endpoint filters by user_id — must pass user_id query param
