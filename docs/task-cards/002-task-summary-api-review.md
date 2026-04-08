# FC-002 Review: Task Summary API

## Status
Done

## Delivery
- GET /v1/tasks/:task_id/summary

## Validation Evidence

### Summary API
```
GET /v1/tasks/f80bf96a-62e0-4868-bacd-21a363e45d3f/summary
→ 200
{
  "summary": {
    "task_id": "f80bf96a-62e0-4868-bacd-21a363e45d3f",
    "summary_id": "sum-001-test",
    "goal": "User greeted with hello",
    "confirmed_facts": [
      "Agent responded with greeting",
      "Response was from fast model (Qwen)"
    ],
    "completed_steps": [
      "Received message",
      "Routed to fast model",
      "Returned greeting"
    ],
    "blocked_by": [],
    "next_step": "None - simple greeting task completed",
    "summary_text": "Simple chat interaction completed successfully with low token usage.",
    "version": 1,
    "updated_at": 1775546749364
  }
}
```

### Error Handling
```
GET /v1/tasks/fake-id/summary
→ 404 {"error": "Task not found: fake-id"}

GET /v1/tasks/task-no-summary-001/summary
→ 404 {"error": "Summary not found for task: task-no-summary-001"}
```

## Regression Checks
- GET /v1/tasks/all → 200 ✅
- GET /v1/tasks/:id → 200 ✅
- POST /api/chat → 200 ✅

## Commit
- 39263a8 feat: implement Task Summary API (FC-002)

## Notes
- Summary response is structured and usable.
- Arrays (confirmed_facts, completed_steps, blocked_by) stored as TEXT[] in PostgreSQL, returned directly as arrays.
- Timestamp format is unix ms integer — need to align with other APIs in future consistency pass.
- Chat endpoint reference in docs corrected from /v1/chat → /api/chat (done in FC-003 scope as planned).
- Route order in tasks.ts: /:task_id/summary registered before /:task_id to avoid Hono 4.x shadowing.

## Review Checklist
- [x] returns 200 with all required fields for existing task with summary
- [x] distinguishes task not found (404) vs summary not found (404) with different messages
- [x] all arrays returned as proper arrays, not serialized strings
- [x] regression tests passed
- [x] implementation is incremental, no unrelated code touched
