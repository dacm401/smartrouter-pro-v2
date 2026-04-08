# Current Sprint

**Sprint 05 — Execution Loop / Tool Actions**
**Status:** 🟡 Planning (proposal draft)

---

## Task Cards

| Task Card | Status | Notes |
|---|---|---|
| EL-001 Tool Definition + Registry | ✅ Done | commit `8d1079d` |
| EL-002 Task Planner | ✅ Done | commit `e491917` + `3894c3a` (pending push) |
| EL-003 Execution Loop | ✅ Done | commit pending |
| EL-004 Tool Guardrails + External API Safety | 🔴 Pending | Security layer |

---

## Proposal

See `docs/sprint-05-proposal.md` for full scope, architecture, and design decisions.

---

## Sprint 04 Summary (completed 2026-04-08)

Memory v2: retrieval strategy + category-aware injection + lexical relevance ranking.

**Sprint 04 commits:** `4893585`, `01c9075`, `6c66797`, `33d4ac7`

---

## Sprint 04 Summary

Memory v2 upgrades the v1 memory injection system with:

- **Retrieval scoring**: importance (30) + recency (20) + keyword relevance (15) = max 65 pts
- **Category-aware formatting**: grouped sections with human-readable labels
- **Jaccard-normalised keyword matching**: stopword-filtered, stemmed, no long-text inflation
- **v1/v2 strategy toggle**: safe upgrade path, v1 as fallback
- **Explainable scores**: every result carries a `reason` string

**Key docs:**
- `docs/sprint-04-review.md` — Sprint 04 retrospective
- `docs/runtime-flow.md` — Memory v2 pipeline documented
- `docs/repo-map.md` — updated with new modules

---

## Next Sprint

See `docs/sprint-05-proposal.md` — proposal is drafted, pending review.
