# Backlog

Known issues and deferred items that are not blocking current Sprint.

---

## Technical Debt

### decision-logger SQL placeholder bug
- **Status**: verified not a bug ✅ (ER-001, 2026-04-08)
- **Priority**: n/a
- **Blocking**: no
- **Resolution**: INSERT has 27 columns, 27 placeholders ($1–$27), and 27 params — all aligned. The `syntax error` claim was inaccurate; the INSERT executes correctly. The error caught by the try/catch wrapper is from a different cause.

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
