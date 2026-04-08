# Sprint 08 Review — Execution Result Retrieval and Injection

## Task Cards

| Card | Description | Status | Commit |
|---|---|---|---|
| RR-001 | Execution Result Injection Config | ✅ Done | — |
| RR-002 | Execution Result Formatter Service | ✅ Done | — |
| RR-003 | chat.ts — Retrieve and Inject Before Planning | ✅ Done | — |
| RR-004 | Policy Controls + Kill Switches | ✅ Done | — |

---

## RR-001: Execution Result Injection Config

**Commit:** included in Sprint 08 feature commit

Added `config.executionResult` block to `backend/src/config.ts`:

```typescript
executionResult: {
  enabled: process.env.EXECUTION_RESULT_INJECTION_ENABLED !== "false",
  maxResults: parseInt(process.env.EXECUTION_RESULT_MAX_RESULTS || "3"),
  maxTokensPerResult: parseInt(process.env.EXECUTION_RESULT_MAX_TOKENS || "200"),
  allowedReasons: (process.env.EXECUTION_RESULT_ALLOWED_REASONS
    ? process.env.EXECUTION_RESULT_ALLOWED_REASONS.split(",")
    : ["completed"]),
},
```

Mirrors the `config.memory` pattern — typed sub-object under `config`, used directly in chat.ts.

---

## RR-002: Execution Result Formatter Service

**Commit:** included in Sprint 08 feature commit

New file: `backend/src/services/execution-result-formatter.ts`

Function: `formatExecutionResultsForPlanner(results, maxChars): string`

**Output format:**
```
=== Recent Execution Results ===

[1] Task: {task_id} | Reason: {reason} | Tools: {n} tools | {timestamp}
    Result: {truncated final_content}

[2] ...

===
```

**Design decisions:**
- Pure transform: no I/O, no side-effects, easy to unit-test
- Token budget guard: `maxChars` (≈ maxTokens × 4 chars/token) with word-boundary truncation
- Filters out results with empty/whitespace `final_content`
- ISO 8601 timestamps (locale-formatted for readability)
- Returns `""` when no results → caller handles gracefully (no empty context block injected)

**Tests:** 17 cases covering empty input, single/multiple results, truncation, singular/plural tool_count, timestamp format, reason field, all-pass / all-filtered scenarios.

---

## RR-003: chat.ts — Retrieve and Inject Before Planning

**Commit:** included in Sprint 08 feature commit

Modified files: `backend/src/api/chat.ts`, `backend/src/services/task-planner.ts`

### chat.ts changes:
1. New import: `formatExecutionResultsForPlanner`
2. After memory retrieval (line 88), added execution result retrieval block:
   - Queries `ExecutionResultRepo.listByUser(userId, maxResults)` with try/catch
   - Filters by `config.executionResult.allowedReasons`
   - Formats via `formatExecutionResultsForPlanner()`
   - Errors degrade gracefully: logs warning, continues planning without context
3. `taskPlanner.plan()` call now passes `executionResultContext`

### task-planner.ts changes:
1. Extended `plan()` signature with optional `executionResultContext?: string`
2. Messages array now uses spread: `...(executionResultContext ? [{ role: "system", content: executionResultContext }] : [])`
3. When context is empty string (no results), spread resolves to nothing — planner unchanged for first-time users

### Data flow:
```
memory retrieval → execution result retrieval → taskPlanner.plan(executionResultContext)
                                                    ↓
                              [system: PLANNER_SYSTEM_PROMPT]
                              [system: execution result context] ← new
                              [user: Goal + Available tools]
```

### Boundary: only execute mode
Injection only happens when `body.execute === true`. Non-execute path is entirely unchanged.

---

## RR-004: Policy Controls and Kill Switches

All failure modes degrade gracefully:

| Failure Mode | Behavior |
|---|---|
| `EXECUTION_RESULT_INJECTION_ENABLED=false` | Retrieval skipped entirely; planner receives no context |
| `ExecutionResultRepo.listByUser()` throws | `catch` logs warning; planning proceeds without context |
| No execution results in DB | `formatExecutionResultsForPlanner()` returns `""`; spread resolves to empty; planner unchanged |
| All results filtered out (reason mismatch) | Same as above |
| First-time user / no history | Same as above |

**Token budget:** `maxTokensPerResult * 4` character cap per entry in formatter; `formatSingleResult()` applies word-boundary truncation.

**allowedReasons default:** `["completed"]` — only successful runs are promoted to planning context. This is conservative by design: step_cap/tool_cap/no_progress results are persisted but not injected until explicitly configured.

---

## System-Level Changes

The planner now has **contextual awareness of past executions**. This completes the memory loop opened in Sprint 07:

```
Sprint 07: execution → result saved
Sprint 08: planning ← result retrieved + injected

Full loop:
  memory retrieval → execution result retrieval → plan → execute → result saved
                                                                    ↑
                                            (next request starts here)
```

The planner doesn't know where the context comes from — it just sees a richer set of prior context. This is intentional: keeping the planner simple and context-source-agnostic.

---

## Test Results

**Full suite: 101/101 ✅** (84 existing + 17 new formatter tests)

---

## Files Modified

| File | Change |
|---|---|
| `backend/src/config.ts` | RR-001: `executionResult` config block |
| `backend/src/services/execution-result-formatter.ts` | RR-002: new file |
| `backend/tests/services/execution-result-formatter.test.ts` | RR-002: 17 tests |
| `backend/src/api/chat.ts` | RR-003: result retrieval + injection |
| `backend/src/services/task-planner.ts` | RR-003: `executionResultContext` param |
| `docs/runtime-flow.md` | RR-004: injection step documented |
| `docs/sprint-08-proposal.md` | RR-004: proposal |
| `docs/current-sprint.md` | RR-004: sprint tracking |
| `docs/next-sprint-proposal.md` | RR-004: sprint tracking |
