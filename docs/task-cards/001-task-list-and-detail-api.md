# Feature Card 001: Task List and Task Detail API

## Goal
Implement task list and task detail APIs so the frontend and debugging workflow can inspect runtime tasks.

---

## Scope

### Endpoints
- GET /v1/tasks
- GET /v1/tasks/:task_id

### Includes
- route definitions
- request parsing
- query filtering where practical
- task response DTO
- service methods to fetch task data
- error handling for missing task

---

## Non-Goals

- advanced search
- pagination optimization
- permission system redesign
- task deletion
- task edit actions

---

## Data Expectations

### Task List Response Should Include
- task_id
- title
- mode
- status
- complexity
- risk
- updated_at
- session_id

### Task Detail Response Should Include
- task_id
- title
- mode
- status
- complexity
- risk
- goal
- budget_profile
- tokens_used
- tool_calls_used
- steps_used
- summary_ref
- created_at
- updated_at

---

## Acceptance Criteria

- task list endpoint returns tasks in a stable structure
- task detail endpoint returns a single task by id
- missing task returns structured error
- implementation does not break existing POST /api/chat
- code follows existing Fastify + Prisma structure

---

## Suggested Files

- task route/controller file
- task service file
- task schema file
- app route registration
- optional DTO helper file

---

## Test Steps

1. create one or more tasks via POST /api/chat
2. call GET /v1/tasks
3. verify tasks appear
4. call GET /v1/tasks/:task_id
5. verify returned detail matches stored task
6. call GET with a fake id and verify structured error

---

## Review Checklist

- is controller thin?
- is DB query logic in service?
- are response fields stable and explicit?
- is missing task handled cleanly?
- is unrelated code untouched?
