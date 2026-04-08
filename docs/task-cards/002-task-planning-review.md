# EL-002 Review: Task Planner

**Task Card:** EL-002
**Sprint:** 05 — Execution Loop / Tool Actions
**Status:** ✅ Done
**Commit:** _(pending)_

---

## What was built

### New files

| File | Purpose |
|---|---|
| `backend/src/services/task-planner.ts` | `TaskPlanner` class + `taskPlanner` singleton |
| `backend/src/models/providers/base-provider.ts` | Extended: `ToolCallParam`, `ToolParam`, `tool_calls` in `ModelResponse` |
| `backend/src/models/providers/openai.ts` | Extended: `tools` param + `tool_choice: "auto"`, extracts `tool_calls` from response |
| `backend/src/models/providers/anthropic.ts` | Signature aligned (tools param stub, no-op for now) |
| `backend/src/models/model-gateway.ts` | New: `callModelWithTools()` |

### Modified files

| File | Change |
|---|---|
| `backend/src/types/index.ts` | No change (ExecutionPlan/ExecutionStep from EL-001) |

---

## Key design decisions

### 1. No extra LLM call for planning
The planner injects a system prompt instructing the model to emit a `plan_task` Function Call in the same response as the first loop iteration. This avoids a separate planning round-trip and keeps the token budget predictable.

### 2. `plan_task` as a structured output mechanism
The model is given a `plan_task` tool with a JSON Schema for the full plan. This is more reliable than asking the model to output JSON in a plain text message — Function Calling provides parseable structured output without prompt engineering tricks.

### 3. Provider-level tools support
Extended the `ModelProvider` interface to accept an optional `tools` parameter. The OpenAI provider passes tools + `tool_choice: "auto"` to the API. Anthropic accepts the param but logs a note (tool_use for Claude is a future enhancement).

### 4. Graceful fallback
If the model doesn't call `plan_task` (malformed response, non-compliant model), `synthesizeFallbackPlan()` produces a single-step reasoning plan. This prevents planning failures from blocking the entire execution.

### 5. Plan written to task_traces
The plan (step IDs, titles, types, tool names) is written to `task_traces` with type `"planning"`. This makes the plan auditable without needing a separate plan storage table.

---

## Planning system prompt

The `PLANNER_SYSTEM_PROMPT` instructs the model to:
- Keep the plan minimal (use the fewest steps needed)
- Classify each step as `tool_call` (needs a registered tool) or `reasoning` (model completes internally)
- Never call a tool for a `reasoning` step
- Specify the exact tool name from: `memory_search`, `task_read`, `task_update`, `task_create`, `http_request`, `web_search`
- Return the plan via `plan_task` tool call only (no plain text response)

---

## Limitations (v1)

- **Linear plans only**: no branching, no conditional paths
- **No re-planning**: if a step fails, the loop handles it (EL-003), not the planner
- **No step-level retry policies**: handled at loop level (EL-003)
- **Planner uses slow model by default** (`gpt-4o`): configurable via `model` param
- **No multi-turn planning**: plan is produced in one shot

---

## Acceptance checklist

- [x] `TaskPlanner.plan()` produces an `ExecutionPlan` via Function Calling
- [x] `callModelWithTools()` wired through provider → OpenAI → API
- [x] `tool_calls` extracted from OpenAI response and parsed
- [x] `plan_task` tool schema defined with full step structure
- [x] `PLANNER_SYSTEM_PROMPT` constrains model to structured output
- [x] Fallback single-step plan when model doesn't use `plan_task`
- [x] Plan written to `task_traces` (type: `"planning"`)
- [x] `npx tsc --noEmit` passes with zero errors
- [x] Existing single-turn path untouched

---

## Dependencies

- `types/index.ts` — `ExecutionPlan`, `ExecutionStep` (EL-001)
- `tools/registry.ts` — `toolRegistry.getFunctionCallingSchemas()` (EL-001)
- `models/providers/base-provider.ts` — `ToolCallParam`, `ToolParam` (this card)
- `models/providers/openai.ts` — Function Calling support (this card)
- `db/repositories.ts` — `TaskRepo.createTrace()` (existing)

---

## Deferred

- `plan_task` tool auto-detection from registry (instead of hardcoded schema)
- Multi-turn planning with self-reflection
- Separate fast-model planner for lightweight goals
- Step dependency graph (beyond linear)
