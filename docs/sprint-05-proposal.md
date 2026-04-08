# Sprint 05 Proposal: Execution Loop / Tool Actions

**Author:** 蟹小钳 🦀
**Date:** 2026-04-08
**Status:** Draft — pending review

---

## Context

Sprint 04 completed the Memory v2 upgrade: smarter retrieval, category-aware injection, lexical relevance ranking, and a complete documentation闭环.

The chat runtime now has:
- Rich context assembly (memory v2 + task summary)
- Structured prompt modes (direct / research)
- Per-turn task and trace tracking
- Quality gate + fallback logic

**What is still missing:** the ability to *do* things, not just answer.

The system handles single-turn text responses well. But complex user goals require multi-step decomposition and tool execution — which the current architecture does not support.

---

## Sprint 05 Goal

**Name:** Execution Loop / Tool Actions

**Goal:** Enable the chat runtime to decompose complex goals into substeps, call tools to execute actions, and return results — in addition to generating text responses.

This is not "add a few API wrappers." It is building a **plannable, executable, trackable runtime layer** that coexists with the existing single-turn path.

---

## Architecture Overview

```
User Message
  ├── Low-complexity → existing single-turn path (direct call, no planning)
  │
  └── High-complexity → Execution Loop
        ├── TaskPlanner     → decompose goal into steps
        ├── ExecutionLoop   → iterate: call model → parse tool calls → execute → feed back
        ├── ToolRegistry    → manages available tools + schemas
        ├── ToolExecutor    → executes individual tool calls, returns results
        └── Guardrail       → pre-execution check for external API calls
```

---

## Tool Calling Strategy

**Mixed approach** (per user direction):

| Scenario | Method |
|---|---|
| Complex multi-step tasks (mode=execute) | Function Calling / Tool Use (structured) |
| Simple commands within direct/research mode | Lightweight text parsing (regex command extraction) |

Function Calling is used for:
- Tasks with `mode: "execute"` OR `complexity: "high"`
- Tool calls that require structured parameters
- External API invocations

Lightweight parsing is used for:
- Inline simple commands within an otherwise direct response
- e.g. "search for X" → parse → call tool → inject result → continue

---

## Tool Ecosystem

**Internal tools (Phase 1, always allowed):**
- `memory_search` — search user memory entries
- `task_create` — create a new task
- `task_update` — update task status / fields
- `task_read` — read task details or summary

**External tools (controlled, guardrail-protected):**
- `http_request` — make outbound HTTP GET/POST, allowlist-controlled
- `web_search` — search the web (via configured provider)

All external tool calls pass through a **pre-execution guardrail** that checks:
- Target host against an allowlist
- HTTP method restrictions
- Response size limits
- Audit logging

---

## Task Cards

### EL-001 Tool Definition + Registry

**Scope:**
- Define `Tool` interface: `{ name, description, parameters (JSON Schema), handler }`
- Build `ToolRegistry` class: `register()`, `getTool()`, `listTools()`, `getToolSchema()`
- Register built-in internal tools (memory_search, task_*)
- Register external tool stubs (http_request, web_search)
- Export tool schemas for Function Calling injection

**Key types to add to `types/index.ts`:**
```ts
export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  enum?: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  scope: "internal" | "external";
}

export interface ToolCall {
  id: string;
  tool_name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  call_id: string;
  tool_name: string;
  success: boolean;
  result: unknown;
  error?: string;
  latency_ms: number;
}
```

**New file:** `backend/src/tools/registry.ts`
**New file:** `backend/src/tools/definitions.ts`
**Modified:** `backend/src/types/index.ts`

**Commit:** EL-001

---

### EL-002 Task Planner

**Scope:**
- Build `TaskPlanner` that, given a user goal + mode=execute, produces a `Step[]` plan
- `Step` interface: `{ id, description, tool_name?, depends_on, status }`
- Planner uses a lightweight LLM call (or heuristic) to decompose goals into ordered steps
- If goal is simple (mode=direct), return empty plan (skip to direct call)
- Store the plan in `task_summaries` or a new `execution_plans` table
- Integrate planner into chat.ts: when mode=execute, produce plan before entering loop

**Key question to resolve in this card:**
- Use a separate LLM call for planning ("planning model") OR
- Have the main model produce a plan in structured output mode
- Decision: use **structured Function Calling on the main model** with a planning system prompt — no extra model call needed

**Commit:** EL-002

---

### EL-003 Execution Loop

**Scope:**
- Build `ExecutionLoop`: `{ execute(task, steps) }`
- Loop body:
  1. Call model with current context + available tool schemas
  2. Parse model output for tool calls (Function Calling OR lightweight parse)
  3. Run guardrail check on each tool call
  4. Execute tool calls in parallel where safe (update `TaskRepo.updateExecution`)
  5. Collect results, inject as tool_result messages
  6. Loop until: no more tool calls OR step limit reached (max 10 iterations)
  7. Final model call: synthesize results into user-facing response
- Write `tool_call` traces for each execution step
- Respect `maxIterations` config (default: 10, configurable per complexity)
- Handle failures: if a tool call fails, inject error as result and let model decide retry or skip

**New file:** `backend/src/services/execution-loop.ts`
**New file:** `backend/src/tools/executor.ts`
**Modified:** `backend/src/api/chat.ts` — branch on `mode: "execute"` to enter loop

**Commit:** EL-003

---

### EL-004 Tool Guardrails + External API Safety

**Scope:**
- Build `ToolGuardrail`: `check(toolCall): { allowed: boolean; reason?: string }`
- Allowlist-based: hosts in `config.externalApi.allowlist` are permitted
- Block dangerous methods (DELETE without override flag, etc.)
- Log all external calls to `task_traces` with type `tool_call`
- Config in `config.ts`:
  ```ts
  externalApi: {
    enabled: boolean;
    allowlist: string[];   // e.g. ["api.example.com", "weather.service.com"]
    maxResponseBytes: number;  // default 1MB
    timeoutMs: number;          // default 5000
  }
  ```
- Guardrail failure → return structured error to model, do not throw
- Create `docs/task-cards/004-tool-guardrails-review.md`

**Commit:** EL-004

---

## Design Decisions (Sprint-scoped)

| Decision | Choice | Rationale |
|---|---|---|
| Planning method | Structured output from main model | No extra LLM call, existing model context sufficient |
| Tool call parsing | Dual-mode (Function Calling + lightweight parse) | Matches user requirement for mixed approach |
| External API safety | Allowlist guardrail | Simpler than scoring, predictable, auditable |
| Execution state storage | task_traces + task_summaries | Reuse existing schema, no new tables needed |
| Loop termination | maxIterations (10) + no-more-calls | Prevents runaway loops, respects budget |
| Fallback for tool failures | Inject error, let model decide | Keeps loop resilient without complex retry logic |
| v1 compatibility | mode=direct/research: existing single-turn path untouched | Zero regression on existing callers |

---

## What is NOT in Scope for Sprint 05

- **Embedding / vector retrieval** — Memory v2 lexical approach is sufficient for v1
- **Multi-agent parallelism** — `waiting_subagent` status is a stub, not implemented
- **User-facing tool builder UI** — tool registration is code-level only in this sprint
- **Streaming responses** — separate concern, not blocking execution loop
- **Task migration / history replay** — executing from saved plans is a future card

---

## Success Criteria

- [ ] Chat endpoint handles `mode: "execute"` requests via execution loop
- [ ] Internal tools (memory_search, task_*) execute correctly and return structured results
- [ ] External API calls pass through guardrail and are logged
- [ ] Guardrail blocks non-allowlisted hosts and logs the block
- [ ] Tool call traces are written to `task_traces` with correct type
- [ ] Single-turn path (direct/research) is unaffected
- [ ] `npx tsc --noEmit` passes with zero errors
- [ ] All docs updated: runtime-flow, repo-map, sprint review

---

## Effort Estimate

| Card | Complexity | Notes |
|---|---|---|
| EL-001 Tool Registry | Medium | Core infrastructure, well-scoped |
| EL-002 Task Planner | High | LLM planning integration, need careful boundary |
| EL-003 Execution Loop | High | Main value deliverable, test thoroughly |
| EL-004 Guardrails | Medium | Self-contained, low risk |

**Recommended execution order:** EL-001 → EL-002 → EL-003 → EL-004

---

## Open Questions for Review

1. Should the planner use the same model as the main call, or route to a "planner model" (e.g., a fast/small model)?
2. Should `http_request` tool accept arbitrary URLs (guardrailed) or only pre-registered endpoints?
3. Should tool call results be stored in memory_entries for future retrieval?
