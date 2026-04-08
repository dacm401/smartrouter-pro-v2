# Sprint 08 Proposal

## Recommended Sprint Name

**Execution Result Retrieval and Injection**

---

## Problem Statement

After Sprint 07, `execution_results` rows are persisted after every successful execution. But the planner has no awareness of them. The memory loop is still open:

```
memory → planner → execution → result saved  ✗ not read back
```

The planner approaches every task as if it's never seen a related task before.

---

## Recommended Goal

Before the planner generates a plan, surface recent execution results for the same user as contextual context. This lets the planner know what was attempted, what succeeded, and what kind of tasks the system has handled — without changing how the planner itself works.

---

## Architecture Decision

**Injection point: chat.ts, before `taskPlanner.plan()` is called.**

The injection happens at the orchestration layer, not inside `TaskPlanner`. This means:
- `TaskPlanner` remains unchanged
- chat.ts owns the context composition
- The pattern mirrors exactly how memory retrieval is already done (lines 81–88 in chat.ts)

```
memory retrieval → execution result retrieval → planner call
```

Both happen in chat.ts before planning. The planner receives a richer context without knowing where it came from.

---

## Task Cards

### RR-001: Execution Result Injection Config

**Goal:** Add configuration for execution result injection, parallel to the existing `config.memory` block.

**Scope:**
- `backend/src/config.ts`: new `executionResult` section with:
  - `enabled` — kill switch (`EXECUTION_RESULT_INJECTION_ENABLED`, defaults `true`)
  - `maxResults` — how many recent results to retrieve (default `3`)
  - `maxTokensPerResult` — token budget per result entry (default `200`)
  - `allowedReasons` — only inject results with these reason values (default `["completed"]`)

**Design:** Mirrors the `config.memory` pattern — a typed sub-object under `config`, read by chat.ts.

---

### RR-002: Result Formatting Service

**Goal:** Convert raw `ExecutionResultRecord` rows into a compact, readable text block for model consumption.

**Scope:**
- New `backend/src/services/execution-result-formatter.ts`
- Function `formatExecutionResultsForPlanner(results: ExecutionResultRecord[]): string`

**Output shape:**
```
=== Recent Execution Results ===

[1] Task: {task_id} | Reason: {reason} | Tools: {tool_count} | {created_at}
    Result: {final_content (truncated to maxTokensPerResult)}

[2] ...

===
```

**Rules:**
- Truncate `final_content` at `maxTokensPerResult` with `[...truncated]`
- Skip results with empty `final_content`
- Omit `steps_summary` from direct injection (tool_count + reason are enough for planner context)

**Deliverable:** `formatExecutionResultsForPlanner()` with unit tests.

---

### RR-003: chat.ts — Retrieve and Inject Before Planning

**Goal:** Query recent execution results in the execute branch, format them, and inject them into the planner's context.

**Scope:**
- chat.ts: after memory retrieval (line 88), before `taskPlanner.plan()` (line 91)
- Query: `ExecutionResultRepo.listByUser(userId, config.executionResult.maxResults)`
- Filter by `allowedReasons`
- Format via `formatExecutionResultsForPlanner()`
- Inject as a `role: "system"` message (or `role: "user"` — decide by test) between system and goal

**Messages array after change:**
```typescript
[
  { role: "system", content: PLANNER_SYSTEM_PROMPT },
  { role: "system", content: formatExecutionResultsForPlanner(results) }, // new
  { role: "user",   content: `Goal: ${goal}\n\nAvailable tools: ...` },
]
```

**Note:** The injection is only for execute mode (`body.execute === true`). Non-execute path is unaffected.

**Deliverable:** Updated chat.ts with result retrieval + injection, confirmed via existing execute-mode flow.

---

### RR-004: Policy Controls and Kill Switches

**Goal:** Ensure the injection system degrades gracefully and is controllable.

**Scope:**
- Kill switch: `EXECUTION_RESULT_INJECTION_ENABLED=false` disables the retrieval and injection entirely
- Error handling: if `ExecutionResultRepo.listByUser()` throws, log and continue without blocking planning
- Empty results: if no results found, skip injection (no empty context block injected)
- Token budget: `maxTokensPerResult` enforced in formatter (same pattern as `memory.maxTokensPerEntry`)
- Test: verify kill switch, empty-results path, and error-path all degrade cleanly

**Deliverable:** Confirmed graceful degradation for all failure modes.

---

## Design Decisions

1. **Injection as system message.** Results are factual context, not a user query. System role is appropriate and keeps the goal message clean.

2. **Only `completed` by default.** We inject only successful runs. Step-cap, tool-cap, and no-progress runs are saved but not promoted as context. This keeps injected context trustworthy.

3. **No change to TaskPlanner.** The planner doesn't know it's receiving execution history. This preserves encapsulation and keeps the planner simple.

4. **Formatter is separate from chat.ts.** Clean separation: formatting is a pure transform, chat.ts owns orchestration. Easy to unit-test.

5. **Max 3 results by default.** The planner should not be overwhelmed. Three gives enough history without bloating context. Configurable via `maxResults`.

---

## Out of Scope

- Writing execution results back into `memory_entries` (different data model, follow-on sprint)
- Automatic memory promotion of successful results
- Frontend display of past execution results
- Changing the planner's system prompt based on result history (context injection is sufficient)
- E2e tests (unit + integration coverage is sufficient for this sprint)

---

## Success Criteria

- [ ] `config.executionResult` section with `enabled`, `maxResults`, `maxTokensPerResult`, `allowedReasons`
- [ ] `EXECUTION_RESULT_INJECTION_ENABLED=false` disables retrieval and injection
- [ ] `formatExecutionResultsForPlanner()` produces compact, readable output
- [ ] Planner receives execution result context before generating a plan
- [ ] Empty results / errors degrade gracefully — planning proceeds without injected context
- [ ] `npm run build` succeeds with no errors
- [ ] `npm run test` passes (no regression; new unit tests for formatter)
- [ ] `runtime-flow.md` updated with injection step

---

## Files Reference

Modules to modify:
- `backend/src/config.ts` (RR-001: new `executionResult` section)
- `backend/src/services/execution-result-formatter.ts` (RR-002: new file + tests)
- `backend/src/api/chat.ts` (RR-003: query + inject before planning)
- `docs/runtime-flow.md` (RR-004: document injection step)

New files:
- `backend/src/services/execution-result-formatter.ts`
- `backend/tests/services/execution-result-formatter.test.ts`
- `docs/sprint-08-proposal.md` (this file)
- `docs/task-cards/rr-001~rr-004-*.md` (RR-004: review docs)
