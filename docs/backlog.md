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
- **Status**: identified
- **Priority**: low
- **Blocking**: no
- **Suggested scope**: post-Sprint cleanup
- **Detail**: All current APIs return `updated_at` / `created_at` as unix ms integers. Need to decide: stay with unix ms or switch to ISO 8601 strings. Whichever is chosen, it should be consistent across all endpoints. Do not mix formats.

---

## Doc Corrections Done

- `/v1/chat` → `/api/chat` corrected in all feature cards (done during FC-003 scope)
