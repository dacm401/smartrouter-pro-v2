# TC-006 Review: Prompt and Runtime Module Cleanup

## Status
Done

## Goal
Move `context-manager.ts` to `services/`, clarify prompt/runtime module placement, and keep `/api/chat` behavior fully unchanged.

## Cleanup Plan

### Decision: Move `context-manager.ts` → `services/`

**Rationale:**
- `manageContext()` is an orchestration function — it accepts a `systemPrompt`, coordinates token budgeting, compression, and message assembly
- This is service-layer responsibility, not a pure context utility
- `context/` remains home to `token-budget.ts` and `compressor.ts` (pure context utilities)
- After move, `services/` now holds: `prompt-assembler.ts`, `memory-store.ts`, `context-manager.ts` — clean semantic grouping

## Changes Applied

| Change | Detail |
|---|---|
| File moved | `src/context/context-manager.ts` → `src/services/context-manager.ts` |
| `chat.ts` import | `../context/context-manager.js` → `../services/context-manager.js` |
| `context-manager.ts` internal imports | `./token-budget.js` / `./compressor.js` → `../context/token-budget.js` / `../context/compressor.js` |
| `repo-map.md` updated | Path + runtime flow annotation both updated |

## Validation

| Check | Result |
|---|---|
| TypeScript build (tsc --noEmit) | ✅ Zero errors |
| Container restart | ✅ |
| POST /api/chat (direct) | ✅ |
| POST /api/chat (research) | ✅ |
| GET /v1/tasks/all | ✅ |
| GET /v1/tasks/:id | ✅ |
| GET /v1/tasks/:id/summary | ✅ (not-found for new task = expected) |
| GET /v1/tasks/:id/traces | ✅ |
| Import residual scan | ✅ No broken paths |

## Deferred Items
- `context/` remaining files (`token-budget.ts`, `compressor.ts`) remain in place — pure utility, no urgency
- Context subsystem architecture review — out of TC-006 scope

## Notes
- Scope stayed tight: one file move, two import updates, docs sync
- No behavior change to `/api/chat` — zero regressions confirmed
- `context/` vs `services/` boundary now reflects the real distinction (utility vs orchestration)

## Regression Notes
- `GET /v1/tasks/:id/summary` may return `404 "Summary not found"` for newly created tasks that have no summary record yet — this is expected behavior, not a regression. Distinguish between: (a) task not found → 404 with `Task not found`, and (b) task exists but summary not yet generated → 404 with `Summary not found`.
