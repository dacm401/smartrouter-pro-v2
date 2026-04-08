# Current Sprint

## Sprint Name
Repository Cleanup and Runtime Foundation Hardening

## Sprint Goal
Improve repository clarity, runtime boundaries, and engineering consistency before adding larger new capabilities.

---

## In Scope

### Repository Structure
- review current folder/module layout
- define target backend structure
- reduce confusing demo-era leftovers
- group related runtime logic more clearly

### Runtime Boundaries
- clarify route / service / repository responsibilities
- review task-related access paths
- review prompt-related module placement
- reduce scattered runtime logic where practical

### Consistency
- standardize time field format across APIs
- review endpoint naming consistency
- document actual runtime request flow
- align docs with real implementation

### Cleanup Targets
- prompt-related code organization
- task read/query path clarity
- backlog triage for low-risk cleanup items
- identify modules safe to defer

---

## Out of Scope

- Memory v1 feature implementation
- Evidence/Retrieval v1 implementation
- multi-agent runtime
- execute loop
- frontend UI expansion
- production deployment hardening
- major schema redesign unless required by cleanup

---

## Acceptance Criteria

### Structure
- a documented target folder/module structure exists
- at least the most confusing areas are reorganized or clearly marked

### Runtime Clarity
- route / service / repository boundaries are easier to understand
- prompt-related logic placement is clearer
- task read paths are easier to trace

### Consistency
- API time field format is standardized or explicitly documented
- docs no longer conflict with actual endpoint paths
- runtime flow doc exists and matches current behavior

### Delivery Quality
- cleanup work is incremental
- existing APIs continue working
- /api/chat continues working
- no major regression introduced by cleanup

---

## Risks

- cleanup can sprawl if not scoped carefully
- file moves may create import breakage
- tempting to refactor too broadly once structure work starts

---

## Success Definition

At the end of this sprint:
- the repository is easier to navigate
- runtime boundaries are clearer
- future Memory v1 work can be added with less ambiguity

---

## Sprint Progress

| Task Card | Status |
|---|---|
| TC-005 Repo Structure Audit + First Cleanup | ✅ Done |
| TC-006 Prompt / Runtime Module Cleanup | ✅ Done |
| TC-007 API Consistency and Time Format | Pending |
| TC-008 Runtime Flow Documentation | Pending |

