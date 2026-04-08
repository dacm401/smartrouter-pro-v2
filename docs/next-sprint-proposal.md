# Next Sprint Proposal

> **Status:** Sprint 08 proposal below. Sprint 07 (Execution Result Memory Persistence) completed 2026-04-08.

---

## Recommended Sprint Name
**Execution Result Retrieval and Injection**

## Recommended Goal
Retrieve recent execution results from `execution_results` and inject them as contextual context before the planner generates a plan. Completes the memory loop: execution results inform future planning.

---

## Why This Sprint Now

Sprint 05 delivered a functional Execution Loop (ExecutionLoop + ToolGuardrail + ToolExecutor). The system can run, but:

1. **No regression protection.** Any future change risks silently breaking the loop's state machine.
2. **Trace data exists but is not accessible.** task_traces stores everything; no API to read it meaningfully.
3. **External tool handlers have real network calls.** http_request needs test doubles to run reliably in CI.

Adding tests *before* the next feature sprint protects the investment and makes expansion safer.

---

## Priority Candidates

### Option A: Testing and Observability for Execution ← **Recommended**
Focus on:
- ExecutionLoop unit tests (state machine, step transitions, guardrail propagation)
- ToolExecutor integration tests (mocked, no real HTTP)
- Guardrail policy tests (pure unit tests on validate())
- Execution trace API (structured step timeline read path)

### Option B: Execution Result Memory Persistence
Focus on:
- Store loop final result back to memory_entries or a new table
- execution_result table (execution_id, task_id, final_content, steps_summary, memory_entries_used)
- POST /v1/executions/:id/persist-result
- Memory read during next planning call

### Option C: Execution Trace UI
Focus on:
- Frontend execution timeline visualization
- Step-by-step playback
- Guardrail decision viewer

---

## Recommendation
Run **Option A first**.

Reason:
The execution engine is the foundation for all future agent capabilities. Protecting it with tests and unlocking its trace data is the highest-leverage investment right now. Options B and C both build on top of what A establishes.

---

## Suggested Scope for Next Sprint

**TA-001:** ExecutionLoop unit tests (tests/services/execution-loop.test.ts)
**TA-002:** ToolExecutor integration tests (tests/services/tool-executor.test.ts)
**TA-003:** Guardrail policy tests (tests/services/tool-guardrail.test.ts)
**TA-004:** Execution trace API (GET /v1/executions/:id/steps, GET /v1/executions/:id/guardrails)

---

## Success Criteria

- [ ] ExecutionLoop state machine has ≥80% branch coverage in unit tests
- [ ] Guardrail policies have 100% coverage of each rule
- [ ] All 3 tool handlers (memory_search, task_get, task_list) have at least one passing integration test
- [ ] Trace API returns structured step timeline for a known execution_id
- [ ] `npm run test` passes with zero failures
- [ ] No regression in existing `npm run build` or `/api/chat` path

---

## Key Docs
- `docs/sprint-06-proposal.md` — full sprint scope, architecture, and design decisions
- `docs/sprint-05-review.md` — Sprint 05 retrospective (completed 2026-04-08)
- `docs/sprint-05-proposal.md` — Sprint 05 original proposal
