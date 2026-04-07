# FC-001 Review: Task List and Task Detail API

## Status
Done

## Delivery
- GET /v1/tasks/all
- GET /v1/tasks/:task_id

## Validation Evidence

### Task List API
```
GET /v1/tasks/all?user_id=test-user
→ 200
{
  "tasks": [
    {
      "task_id": "f80bf96a-62e0-4868-bacd-21a363e45d3f",
      "title": "?????????",
      "mode": "direct",
      "status": "completed",
      "complexity": "low",
      "risk": "low",
      "updated_at": 1775544097295,
      "session_id": "session-001"
    }
  ]
}
```

### Task Detail API
```
GET /v1/tasks/f80bf96a-62e0-4868-bacd-21a363e45d3f
→ 200
{
  "task": {
    "task_id": "f80bf96a-62e0-4868-bacd-21a363e45d3f",
    "user_id": "test-user",
    "session_id": "session-001",
    "title": "?????????",
    "mode": "direct",
    "status": "completed",
    "complexity": "low",
    "risk": "low",
    "goal": "?????????",
    "budget_profile": {},
    "tokens_used": 92,
    "tool_calls_used": 0,
    "steps_used": 1,
    "summary_ref": null,
    "created_at": 1775544092761,
    "updated_at": 1775544097295
  }
}
```

### Error Handling
```
GET /v1/tasks/fake-id-12345
→ 404 (not 500)
{"error": "Task not found: fake-id-12345"}
```

## Fixes Included
- API URL forced to localhost:3001 (frontend/src/lib/api.ts)
- history undefined issue fixed (router.ts)
- Hono 4.x route conflict: /all for list endpoint

## Commit
- 88334be feat: implement Task List and Detail API (FC-001)

## Notes
- Task list and detail APIs are now available for task inspection and later frontend integration.
- Response structure matches expected DTO; verified all required fields present.
- Chinese title shows as "?????????" in curl output due to Windows terminal encoding, actual DB data is correct.
- decision-logger has a SQL placeholder bug ($27 missing) — non-blocking, affects FC-005 observatory.
- **Doc correction**: chat endpoint is `/api/chat` (not `/v1/chat`). Feature card docs will be updated in FC-003 scope.

## Review Checklist
- [x] task list returns task_id, title, mode, status, complexity, risk, updated_at, session_id
- [x] task detail returns all 14 required fields
- [x] fake id returns 404 with structured error
- [x] POST /api/chat regression tested → 200, returns response with decision object
- [x] Doc path correction noted: /v1/chat → /api/chat
