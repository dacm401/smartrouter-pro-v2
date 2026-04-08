# Current Sprint

## Sprint Name
Memory v2: Retrieval and Relevance

## Sprint Goal
Make memory injection smarter by introducing lightweight relevance-based retrieval and category-aware injection policies. Memory v1 selects by recency + importance only; Memory v2 adds context-aware scoring so that injected memories are targeted, not just abundant.

---

## In Scope

### MR-001 Memory Retrieval Policy
- Design and implement a scoring policy for memory entry retrieval
- Criteria: recency, importance, category match, topic proximity
- Enhance `MemoryEntryRepo.getTopForUser()` to accept retrieval context
- Document the scoring logic; keep it explainable

### MR-002 Category-Aware Injection
- Memory categories (`preference`, `fact`, `context`, `goal`, `constraint`) are stored but not yet used at injection time
- Introduce category-specific injection rules (e.g., always inject `goal` + `constraint`; treat `preference` as opt-in)
- Config-based toggle for category injection policy

### MR-003 Relevance Ranking for Chat Context
- Extract lightweight topic/context signal from incoming `userMessage`
- Score and rank memories against conversation context before injecting
- Keep lightweight: no heavy ML, no external vector DB dependency for v2

### MR-004 Review + Guardrails
- End-to-end retrieval path regression test
- Update `runtime-flow.md` with new retrieval logic
- Update `repo-map.md` with retrieval scoring components
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

---

## Open Questions

| Question | Notes |
|---|---|
| How to extract topic signal from `userMessage`? | Simple keyword extraction vs lightweight embedding |
| Should category rules be config-driven or code-driven? | Preference: config-driven for flexibility |
| What's the minimum viable scoring model? | Recency + importance is baseline; topic match is v2 addition |
| How to test retrieval quality? | Need a test corpus of memory entries + sample queries |

---

## Risks

| Risk | Mitigation |
|---|---|
| Retrieval logic adds latency to chat response | Keep scoring lightweight; measure before/after |
| Over-engineering scoring model | Start simple: keyword match + recency/importance |
| Breaking existing memory injection behavior | Keep v1 behavior as default; new policy behind feature flag |

---

## Sprint Progress

| Task Card | Status |
|---|---|
| MR-001 Memory Retrieval Policy | Pending |
| MR-002 Category-Aware Injection | Pending |
| MR-003 Relevance Ranking for Chat Context | Pending |
| MR-004 Review + Guardrails | Pending |

---

## Sprint 04 Readiness Check

- [x] Sprint 03 review doc created (`sprint-03-review.md`)
- [x] Sprint 04 proposal created (`sprint-04-proposal.md`)
- [x] Sprint 04 cards drafted (MR-001 ~ MR-004)
- [ ] Sprint 03 officially archived (pending this sprint doc)
- [ ] Sprint 04 kickoff

---

## Sprint 03 Archive

**Sprint 03 Result:** Completed ✅  
**Closed:** 2026-04-08  
**Commits:** `483a36b` (MC-001) · `50a0cf4` (MC-002) · `ac44427` (MC-003) · `3253e21` (MC-004)  
**Review:** `docs/sprint-03-review.md`

