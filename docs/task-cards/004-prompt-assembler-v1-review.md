# FC-004 Review: PromptAssembler v1

## Status
Done

## Delivery
- New module: `backend/src/services/prompt-assembler.ts`
- Integration: `ChatService` now calls `assemblePrompt()` before `manageContext()`
- Modified: `context-manager.ts` accepts external `systemPrompt` parameter

## Structural Change
- `ChatService` no longer uses the hardcoded system prompt in `context-manager.ts`
- Prompt construction is centralized in `PromptAssembler`
- System prompt is assembled per-request based on mode (direct / research)

## Prompt Sections (v1)
| Section | Required | Description |
|---|---|---|
| core_rules | Yes | Base behavior: accuracy, no fabrication, clear formatting |
| mode_policy | Yes | Mode-specific instructions (direct: concise; research: structured) |
| task_summary | No | Optional task context (goal, summary text, next step) |
| user_request | Yes | User's original message |

## Validation Evidence
- direct mode (simple_qa/chat/unknown): POST /api/chat → 200, response normal
- research mode (reasoning/code/etc): POST /api/chat → 200, structured response
- intent field correctly routes: "What is 2+2?" → research (score-based routing expected)

## Regression Checks
- GET /v1/tasks/all → 200
- GET /v1/tasks/:id → 200
- GET /v1/tasks/:id/summary → 404 (no summary written, expected)
- GET /v1/tasks/:id/traces → 200, 3 traces, detail as structured object
- fake task → 404

## Commit
- 580db75

## Extension Points (v2+)
- `taskSummary` field in `PromptAssemblyInput` ready for use once summaries are populated
- Add `memoryContext` field for Memory v1
- Add `evidenceContext` field for Evidence/Retrieval v1
- No refactoring needed — just add new section builders

## Notes
- `context-manager.ts` retains a `DEFAULT_SYSTEM_PROMPT` fallback for non-chat callers
- `PromptMode` is typed: only `"direct" | "research"` supported in v1
- Decision to keep `execute` mode out of scope — correct, follow FC spec
