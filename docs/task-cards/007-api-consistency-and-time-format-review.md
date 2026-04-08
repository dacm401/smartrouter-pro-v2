# TC-007 Review: API Consistency and Time Format

## Status
Done

## Goal
Standardize time field format across task-related APIs to ISO 8601 strings.

## Audit Findings

**Before (all time fields = Unix milliseconds number):**

| API | Fields | Format |
|---|---|---|
| `GET /v1/tasks/all` | `updated_at` | `1775615054782` (number) |
| `GET /v1/tasks/:id` | `created_at`, `updated_at` | `1775615043078`, `1775615054782` (numbers) |
| `GET /v1/tasks/:id/summary` | `updated_at` | `1775615043078` (number) |
| `GET /v1/tasks/:id/traces` | `created_at` | `1775615054782` (number) |

**Convention chosen:** ISO 8601 strings (e.g. `"2026-04-08T02:24:14.782Z"`)

**Rationale:**
- Human-readable in logs and debug output
- No ambiguity: "is this seconds or milliseconds?"
- Natural JSON/JS Date parsing
- Consistent with Postgres `TIMESTAMPTZ` storage (no conversion needed)
- Database storage format unchanged (internal `timestamptz` columns stay as-is)

## Changes Applied

### `src/types/index.ts`
- `Task.created_at`: `number` → `string`
- `Task.updated_at`: `number` → `string`
- `TaskListItem.updated_at`: `number` → `string`
- `TaskSummary.updated_at`: `number` → `string`
- `TaskTrace.created_at`: `number` → `string`

### `src/db/repositories.ts`
- `TaskRepo.list()`: `new Date(r.updated_at).getTime()` → `new Date(r.updated_at).toISOString()`
- `TaskRepo.getById()`: `created_at` / `updated_at` → `.toISOString()`
- `TaskRepo.getSummary()`: `updated_at` → `.toISOString()`
- `TaskRepo.getTraces()`: `created_at` → `.toISOString()`

## Validation

| Check | Result |
|---|---|
| TypeScript build (tsc --noEmit) | ✅ Zero errors |
| Container restart | ✅ |
| POST /api/chat (direct) | ✅ |
| POST /api/chat (research) | ✅ |
| `GET /v1/tasks/all` time format | ✅ ISO 8601 string |
| `GET /v1/tasks/:id` time format | ✅ ISO 8601 string |
| `GET /v1/tasks/:id/summary` time format | ✅ ISO 8601 string |
| `GET /v1/tasks/:id/traces` time format | ✅ ISO 8601 string |

## Example After

```json
{
  "task_id": "a351d66c-10aa-4dd2-98a3-e58a0a9adedc",
  "created_at": "2026-04-08T02:24:03.078Z",
  "updated_at": "2026-04-08T02:24:14.782Z",
  "traces": [{
    "trace_id": "...",
    "created_at": "2026-04-08T02:24:14.782Z",
    ...
  }]
}
```

## Deferred Items
- `BehavioralMemory.last_activated` / `created_at` remain `number` (internal only, not a public API)
- Dashboard `/api/dashboard` time fields not audited in this card
- Other non-task APIs not in TC-007 scope

## Notes
- Scope stayed minimal: one type file + one repository file
- No DB schema changes (internal storage untouched)
- No frontend impact assumed (outward API convention only)
- `/api/chat` unchanged (not a task-related endpoint)
