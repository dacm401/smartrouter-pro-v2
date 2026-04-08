# Feature Card 003: Trace API

## Goal
Implement an API to fetch trace records for a task.

---

## Scope

### Endpoint
- GET /v1/tasks/:task_id/traces

### Includes
- route/controller
- service query
- trace response mapping
- parsing trace detail payload when possible

---

## Non-Goals

- trace filtering UI
- trace export
- live streaming trace updates
- trace analytics dashboard

---

## Response Expectations

### Each Trace Should Include
- trace_id
- type
- detail
- created_at

### API Should Include
- task_id
- traces

---

## Acceptance Criteria

- returns trace records for a valid task
- returns empty list if task exists but no traces
- returns structured error if task does not exist
- response can be used by future trace panel UI

---

## Test Steps

1. create a task via POST /api/chat
2. call GET /v1/tasks/:task_id/traces
3. verify classification and response traces exist if they were created
4. verify detail field is returned in usable structure
5. test with fake task id

---

## Review Checklist

- is detail parsed safely?
- does service own the query logic?
- is task existence checked properly?
- is output easy for frontend to consume?
