# Current Sprint

## Sprint Name
Memory v1: User-Editable Persistent Memory

## Sprint Goal
Introduce a minimal viable memory mechanism that is readable, writable, editable, injectable into prompts, and bounded in scope. Memory v1 should be plain but reliable — not an autonomous learning system.

---

## In Scope

### Memory Data Model
- define `memory_entries` table structure
- define TypeScript types for memory objects
- build `MemoryEntryRepo` with CRUD operations

### Memory APIs
- POST /v1/memory — create memory entry
- GET /v1/memory — list memory entries for a user
- GET /v1/memory/:id — get single entry
- PUT /v1/memory/:id — update a memory entry
- DELETE /v1/memory/:id — delete a memory entry

### Prompt Injection
- wire memory entries into `prompt-assembler.ts` via `taskSummary` field (already typed)
- control injection budget (max entries, max tokens)
- direct vs research mode injection policy

### Review and Guardrails
- regression test all existing APIs
- document memory injection policy
- add rate/budget guardrails to prevent runaway injection

---

## Out of Scope

- autonomous long-term learning pipelines
- automatic memory extraction from chat history
- complex conflict resolution / merge strategies
- multi-layer memory hierarchies
- intelligent forgetting strategies
- Evidence / Retrieval v1
- execute loop

---

## Acceptance Criteria

### Memory APIs
- all 5 CRUD endpoints functional and return correct HTTP status codes
- request validation in place
- responses typed and predictable

### Prompt Injection
- `assemblePrompt()` receives memory entries and injects `taskSummary` section when present
- injection respects budget limits (configurable max entries and token cap)
- no regression on existing `/api/chat` direct and research flows

### Quality
- existing APIs continue working
- `/api/chat` continues working
- no major regression introduced by memory work
- review doc for each task card

---

## Risks

- injecting too much memory context can degrade model response quality
- unbounded memory writes could bloat DB if guardrails are missing
- memory model may need to evolve as v1 use patterns emerge

---

## Success Definition

At the end of this sprint:
- users can create, read, update, and delete persistent memory entries
- memory entries are visible to the AI within a chat session via prompt injection
- memory injection is budget-controlled
- existing chat and task APIs are unaffected

---

## Sprint Progress

| Task Card | Status |
|---|---|
| MC-001 Memory Data Model + Repository | ✅ Done |
| MC-002 Memory CRUD APIs | ✅ Done |
| MC-003 Memory Prompt Injection | Pending |
| MC-004 Review + Guardrails | Pending |

