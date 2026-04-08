# MC-002 Review: Memory CRUD APIs

## Result
Completed

---

## What Was Delivered

### New File: `backend/src/api/memory.ts`

Mounted at `/v1/memory` via `index.ts`.

5 REST endpoints implemented:

| Method | Path | Status | Behavior |
|--------|------|--------|----------|
| `POST` | `/v1/memory` | 201 | Create memory entry |
| `GET` | `/v1/memory` | 200 | List entries |
| `GET` | `/v1/memory/:id` | 200 / 404 | Get single entry |
| `PUT` | `/v1/memory/:id` | 200 / 404 | Partial update |
| `DELETE` | `/v1/memory/:id` | 204 / 404 | Delete entry |

### Validation Rules

**POST body:**
- `category` — required, must be one of: preference | fact | context | instruction
- `content` — required, must be non-empty string (trimmed)
- `importance` — optional, integer 1–5 (default handled by repo)
- `tags` — optional, must be string array
- `source` — optional, must be one of: manual | extracted | feedback

**PUT body:**
- Same field-level rules as POST, all optional
- At least one field must be provided (enforced by repo's no-op guard)

**Query param:**
- `user_id` — defaults to "default-user" if absent
- `limit` on GET / — max 100, default 50, must be positive integer

### Error Shape
All errors return `{ error: string }` with appropriate HTTP status:
- 400: validation failure
- 404: not found or not owned
- 500: unexpected server error

### Routing
- No `/all` equivalent needed (no path collision with `/:id`)
- Hono method chaining used for `/:id` (GET + PUT + DELETE on same route)
- Consistent pattern with `tasks.ts`

---

## Design Decisions

### Why method chaining for /:id
Keeps GET, PUT, DELETE on the same route path. No path ordering concerns here (unlike tasks which needed `/all` before `/:task_id`).

### Why `user_id` as query param (not path segment)
Follows same convention as existing task APIs (`/v1/tasks/all?user_id=xxx`). Minimal change — no auth middleware needed. Future MC-004 can introduce proper user scoping if needed.

### Why validate `importance` as integer range on API layer
Repo layer defaults to 3 but does not enforce range. API layer is the right place to catch out-of-range values before they reach the DB.

### Why trim content
Prevents users from submitting whitespace-only entries that are technically non-empty but useless.

---

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| All 5 endpoints functional | ✅ |
| Correct HTTP status codes | ✅ |
| POST validation | ✅ |
| PUT validation | ✅ |
| 404 for non-existent / unowned entries | ✅ |
| TypeScript build zero errors | ✅ |
| `/api/chat` unaffected | ✅ (no code touched) |
| Task APIs unaffected | ✅ (no code touched) |

---

## Non-Goals Enforced
- Prompt injection (MC-003) — not wired
- Authentication middleware — user_id from query param fallback
- Batch operations — not implemented
- Advanced filtering — only `category` filter on list, simple and bounded

---

## Deferred Items
- `source` field write protection (MC-002 only allows 'manual' via user-facing API; system/internal writes for 'extracted'/'feedback' reserved for future service-layer use)
- `importance` max per-user cap (future guardrail in MC-004 if needed)
- Full auth integration (beyond query param user_id)

---

## Files Changed
```
backend/src/api/memory.ts  — NEW router (5 endpoints)
backend/src/index.ts       — ADD memoryRouter mount at /v1/memory
```
