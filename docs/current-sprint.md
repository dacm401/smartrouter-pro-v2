# Current Sprint

**Sprint 06 — Testing and Observability for Execution**
**Status:** 🏗️ In Progress

---

## Task Cards

| Task Card | Description | Status | Commit |
|---|---|---|---|
| TA-001 | ExecutionLoop Unit Tests | ✅ Done | `efada92` |
| TA-002 | ToolExecutor Integration Tests | ✅ Done | `6bd20ba` |
| TA-003 | Guardrail Policy Tests | ✅ Done | `ad55e8b` |
| TA-004 | Execution Trace API | ✅ Done | `62fee5c` |

---

## TA-001 Summary (commit `efada92`, pushed)

- Vitest v4 environment: `vitest.config.ts` + `package.json` scripts
- 20 test cases covering ExecutionLoop state machine
- Bug fixes found during testing:
  1. Mock path fix: `../src/tools/executor.js` → `../../src/tools/executor.js`
  2. Inner catch `break` → `throw err` (JS `break` does not exit outer `while` loop)
- Review doc: `docs/task-cards/ta-001-execution-loop-unit-tests-review.md`

---

## TA-002 Summary (commit `6bd20ba`, pushed)

- 24 test cases: all 6 tool handlers covered
- Architecture discovery: executor.ts mocked at module level with `fetchMock` injection
  (avoids Node.js ESM bare-global `fetch` isolation problem that vi.mock/spyOn/stubGlobal cannot solve)
  - Internal handlers (memory_search, task_*): real implementation logic (DB mocked)
  - External handlers (http_request, web_search): controlled `fetchMock`
- GuardrailRejection propagation: verified distinct from non-guardrail errors
- Review doc: `docs/task-cards/ta-002-tool-executor-integration-tests-review.md`
- All 44 Sprint 06 tests pass (TA-001: 20 + TA-002: 24)

---

## TA-003 Summary (commit `ad55e8b`, pushed)

- 21 test cases: all guardrail policy rules covered
- Pure unit tests — no network, no DB, no fetch mocking
- `http_request`: empty/invalid URL, non-HTTPS, host allowlist, blocked headers (case-insensitive)
- `web_search`: empty/whitespace query, >500 chars, max_results cap at 10
- Unknown tool: fail-closed
- Trace writes: verified on both allowed and rejected decisions
- Review doc: `docs/task-cards/ta-003-guardrail-policy-tests-review.md`
- Full suite: 65 tests pass (TA-001: 20 + TA-002: 24 + TA-003: 21)

---

## TA-004 Summary (pending push)

- Enhanced `GET /v1/tasks/:task_id/traces`: `type`/`limit` query filters, `summaries[]` field
- `backend/src/services/trace-formatter.ts`: NEW — `formatTraceSummary()` for all 11 trace types
- `backend/tests/services/trace-formatter.test.ts`: NEW — 19 test cases
- Expanded `TraceType` from 5 to 11 types
- Review doc: `docs/task-cards/ta-004-execution-trace-api-review.md`
- **Full suite: 84 tests pass (TA-001: 20 + TA-002: 24 + TA-003: 21 + TA-004: 19)**
- **Sprint 06: COMPLETE ✅**

---

## Sprint 05 — Completed and Closed ✅

See `docs/sprint-05-review.md`
