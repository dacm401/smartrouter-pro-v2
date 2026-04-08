# Feature Card 002: Task Summary API

## Goal
Implement an API to fetch structured task summary for a given task.

---

## Scope

### Endpoint
- GET /v1/tasks/:task_id/summary

### Includes
- route/controller
- service method
- summary response DTO
- graceful handling when summary does not exist

---

## Non-Goals

- summary regeneration endpoint
- summary editing UI
- summary history comparison
- summary evaluation pipeline

---

## Response Expectations

### Should Include
- task_id
- summary_id
- goal
- confirmed_facts
- completed_steps
- blocked_by
- next_step
- summary_text
- version
- updated_at

---

## Acceptance Criteria

- endpoint returns summary for an existing task with summary
- endpoint handles task without summary gracefully
- endpoint does not break chat flow
- summary arrays are returned in usable structured form if possible

---

## Implementation Notes

- confirmed_facts and completed_steps may currently be stored as serialized JSON strings
- if so, parse them before returning the response
- keep response format frontend-friendly

---

## Test Steps

1. create a task via POST /api/chat
2. call GET /v1/tasks/:task_id/summary
3. verify summary fields are returned
4. test with a task that has no summary if possible
5. test with fake task id

---

## Review Checklist

- does it parse stored structured fields correctly?
- does it distinguish missing task vs missing summary?
- is response structure stable?
- is implementation narrow and incremental?
