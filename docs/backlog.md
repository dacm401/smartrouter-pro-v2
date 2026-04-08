# Backlog

Known issues and deferred items that are not blocking current Sprint.

---

## Technical Debt

### decision-logger SQL placeholder bug
- **Status**: identified
- **Priority**: medium
- **Blocking**: no
- **Suggested scope**: FC-005 or observatory work
- **Detail**: INSERT in `backend/src/db/repositories.ts:18` has 27 fields but only $1–$26 placeholders. Missing `$27` causes `syntax error at end of input` on every chat request. Non-blocking because the error is caught and logged, but it prevents decision_logs from being written correctly.

---

## Consistency Items

### Timestamp format alignment
- **Status**: resolved ✅ (TC-007, 2026-04-08)
- **Priority**: low
- **Blocking**: no
- **Resolution**: All task-related APIs now return ISO 8601 strings (e.g. `"2026-04-08T02:24:14.782Z"`). Unix milliseconds number format removed from outward API. DB storage unchanged. Other non-task APIs (dashboard) not covered — deferred.

---

## Doc Corrections Done

- `/v1/chat` → `/api/chat` corrected in all feature cards (done during FC-003 scope)
