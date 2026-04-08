# Sprint 03 Review

## Sprint Name
Memory v1: User-Editable Persistent Memory

## Result
**Completed** ✅

---

## Goals
Introduce a minimal, user-editable persistent memory system with clear runtime boundaries, API access, and controlled prompt injection.

---

## Delivered

### MC-001 — Memory Data Model + Repository
- `memory_entries` schema added to `backend/src/db/schema.sql`
- indexes added for user-scoped retrieval and prompt injection ordering
- `MemoryEntry` TypeScript types added to `backend/src/types/index.ts`
- `MemoryEntryRepo` implemented in `backend/src/db/repositories.ts` with 6 methods:
  - `create`, `getById`, `getTopForUser`, `update`, `delete`, `getAllForUser`

### MC-002 — Memory CRUD APIs
- Memory CRUD APIs added under `/v1/memory`
- Endpoints implemented: POST, GET list, GET by-id, PUT, DELETE
- All routes are user-scoped (user_id query param fallback to "default-user")
- Request validation in place for core fields

### MC-003 — Memory Prompt Injection
- Memory injection wired into chat runtime (`backend/src/api/chat.ts`)
- Top memories fetched before prompt assembly via `MemoryEntryRepo.getTopForUser()`
- Memory content passed through existing `taskSummary` prompt path
- Token budget enforcement added in `prompt-assembler.ts` (5 entries × 150 tokens = 750 hard cap)
- Line-boundary truncation with `[...truncated]` marker
- Injection can be disabled via `MEMORY_INJECTION_ENABLED=false` env flag
- `config.memory` configuration section added to `backend/src/config.ts`

### MC-004 — Review + Guardrails
- API guardrails expanded:
  - `content` max length: 2000 chars
  - `tags` max count: 10 per entry
  - individual tag max length: 50 chars
  - list `limit` capped at 100
- `docs/runtime-flow.md` updated: Step 4b (memory injection), Memory API Routes section, data touchpoints
- `docs/repo-map.md` updated: MemoryEntryRepo, memory.ts in API Routes, injection step in runtime flow
- MC-004 review doc completed
- Sprint 03 officially closed

---

## What Improved

### 1. New Persistent User Memory Capability
The system now supports user-managed memory as a first-class backend feature with full CRUD access.

### 2. Runtime Personalization
Chat requests can include bounded memory context during prompt assembly, enabling persistent user preferences.

### 3. Better Safety Boundaries
Memory injection size and API input size are now explicitly constrained:

| Guard | Value | Location |
|---|---|---|
| content max length | 2000 chars | `memory.ts` POST/PUT |
| tags max per entry | 10 | `memory.ts` POST/PUT |
| individual tag max length | 50 chars | `memory.ts` POST/PUT |
| list limit | 100 | `memory.ts` GET |
| injection entries | max 5 | `config.memory.maxEntriesToInject` |
| injection tokens | max 750 | `prompt-assembler.ts` truncation guard |
| feature toggle | env flag | `config.ts` |

### 4. Documentation Quality
Memory v1 is now represented in runtime-flow and repository structure docs, reducing future ambiguity about the memory injection path.

---

## Issues Still Open

### Technical Debt

| Item | Priority | Status |
|---|---|---|
| `DecisionRepo.save()` SQL placeholder mismatch (`$1`–`$27` but 26 values) | P1 | Open (carried from Sprint 02) |
| Internal legacy timestamp handling outside task APIs | P2 | Open (carried from Sprint 02) |
| `MemoryRepo.getIdentity()` read on every chat request (no cache) | P2 | Open (carried from Sprint 02) |

---

## Deferred Work
- Memory v2: Retrieval / Relevance ranking
- Automatic memory extraction from conversations
- Memory deduplication / merge policy
- Evidence-backed memory retrieval
- Execute loop integration if needed
- Richer admin / inspection tooling
- Multi-layer memory hierarchies

---

## Final Assessment
Sprint 03 successfully delivered a minimal but complete Memory v1 capability. The repository now has a clear, user-editable memory layer integrated into both API and runtime prompt assembly, with practical guardrails and updated documentation.

This is not a demo — it is a production-ready capability that can be extended into Memory v2.

---

_Archived: 2026-04-08_
