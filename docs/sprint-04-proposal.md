# Sprint 04 Proposal

## Proposed Sprint Name
**Memory v2: Retrieval and Relevance**

---

## Rationale

Sprint 03 delivered a complete Memory v1 capability: storage, CRUD API, prompt injection, and guardrails. All the plumbing is in place.

The natural next step is making memory injection **smarter**. Currently, `getTopForUser()` selects memories purely by `importance DESC, updated_at DESC` — a simple heuristic that works but is not context-aware.

Sprint 04 aims to introduce **lightweight relevance-based retrieval** so that memory injection is targeted, not just abundant.

---

## In Scope

### MR-001 — Memory Retrieval Policy
- Design and implement a retrieval scoring policy for memory entries
- Criteria candidates: recency, importance, category match, conversation topic proximity
- `MemoryEntryRepo.getTopForUser()` enhanced to accept retrieval context
- Document the current scoring logic; keep it explainable

### MR-002 — Category-Aware Injection
- Memory v1 categories (`preference`, `fact`, `context`, `goal`, `constraint`) are stored but not yet used at injection time
- Introduce category-specific injection rules (e.g., always inject `goal` + `constraint`; treat `preference` as opt-in)
- Config-based toggle for category injection policy

### MR-003 — Relevance Ranking for Chat Context
- When chat request arrives, extract a lightweight topic/context signal from `userMessage`
- Use simple keyword or embedding-based relevance scoring to rank memories
- Score memories against conversation context before injecting
- Keep it lightweight: no heavy ML pipeline, no external vector DB dependency for v2

### MR-004 — Review + Guardrails
- End-to-end retrieval path regression test
- Document retrieval policy in `runtime-flow.md`
- Update `repo-map.md` with new retrieval logic
- Memory v2 review doc

---

## Out of Scope

- Autonomous memory extraction from conversation history
- Vector-based semantic search (save for v3)
- Memory conflict resolution / merge strategies
- Memory expiration / TTL policies
- Multi-user memory sharing
- Evidence-backed memory retrieval
- Execute loop integration

---

## Open Questions (for Sprint Planning)

| Question | Notes |
|---|---|
| How to extract topic signal from `userMessage`? | Simple keyword extraction vs lightweight embedding |
| Should category rules be config-driven or code-driven? | Preference: config-driven for flexibility |
| What's the minimum viable scoring model? | Recency + importance is baseline; topic match is v2 addition |
| How to test retrieval quality? | Need a test corpus of memory entries + sample queries |

---

## Acceptance Criteria

### Retrieval
- Memories can be ranked/scored by relevance to conversation context
- Retrieval scoring is explainable (not a black box)

### Category-Aware Injection
- Category-specific injection rules are configurable
- Default policy: inject high-importance `goal`/`constraint` always; `preference`/`fact`/`context` gated by relevance

### Quality
- No regression on existing Memory v1 APIs or chat flow
- Retrieval path is documented and testable
- Guardrails from v1 remain intact

### Deliverables
- MR-001, MR-002, MR-003, MR-004 all completed and pushed
- `docs/sprint-04-review.md` archived
- `docs/runtime-flow.md` and `docs/repo-map.md` updated

---

## Risks

| Risk | Mitigation |
|---|---|
| Retrieval logic adds latency to chat response | Keep scoring lightweight; measure before/after |
| Over-engineering scoring model | Start simple: keyword match + recency/importance |
| Breaking existing memory injection behavior | Keep v1 behavior as default; new policy behind feature flag |

---

## Estimated Complexity

| Card | Complexity | Notes |
|---|---|---|
| MR-001 | Medium | Scoring policy design + repo method enhancement |
| MR-002 | Low-Medium | Config + conditional injection in chat.ts |
| MR-003 | Medium-High | Topic extraction + scoring integration |
| MR-004 | Low | Documentation + regression |

---

_Proposed: 2026-04-08_
