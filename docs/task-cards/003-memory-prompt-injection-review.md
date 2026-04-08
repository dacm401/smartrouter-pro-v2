# MC-003 Review: Memory Prompt Injection

## ✅ Acceptance Criteria Checklist

| Criteria | Status |
|---|---|
| `assemblePrompt()` with `taskSummary` produces memory entries in system prompt | ✅ |
| `assemblePrompt()` without `taskSummary` unchanged from v1 | ✅ |
| Token cap respected (`maxEntriesToInject * maxTokensPerEntry = 750 tokens`) | ✅ |
| `config.memory.enabled = false` bypasses all memory reads | ✅ |
| TypeScript build passes | ✅ |
| Regression: `/api/chat` direct and research modes pass | ⚠️ local verification only |

---

## 📦 File Changes

### `backend/src/config.ts`
Added `memory` config section:
```ts
memory: {
  maxEntriesToInject: 5,
  maxTokensPerEntry: 150,
  enabled: process.env.MEMORY_INJECTION_ENABLED !== "false",
}
```
- `enabled` defaults to `true` (flip via `MEMORY_INJECTION_ENABLED=false` env var)
- `maxEntriesToInject * maxTokensPerEntry = 750 tokens` hard cap on task_summary section

### `backend/src/api/chat.ts`
Before `assemblePrompt()` call, added memory fetch + taskSummary build:
```ts
const memories = config.memory.enabled
  ? await MemoryEntryRepo.getTopForUser(userId, config.memory.maxEntriesToInject)
  : [];

const taskSummary = memories.length > 0
  ? {
      goal: "User memories:",
      summaryText: memories.map((m) => `[${m.category}] ${m.content}`).join("\n"),
      nextStep: null,
    }
  : undefined;
```
- Memory read is conditional on `config.memory.enabled`
- Falls back to `[]` when disabled (identical to v1 behavior)
- Passed to `assemblePrompt` with `maxTaskSummaryTokens: 5 * 150 = 750`

### `backend/src/services/prompt-assembler.ts`
Three changes:
1. Imported `countTokens` from `../models/token-counter.js`
2. Added optional `maxTaskSummaryTokens?: number` to `PromptAssemblyInput`
3. `buildTaskSummarySection()` now accepts `maxTokens` and enforces truncation if section exceeds budget

Truncation strategy: proportional removal from `summaryText`, preferring line-boundary cuts, appending `[...truncated]`.

---

## 🔑 Key Design Decisions

### No mode split
Both `direct` and `research` modes inject memories the same way. Task card explicitly states no mode skips memory.

### Token budget enforced in assembler, not in chat.ts
`assemblePrompt()` receives `maxTaskSummaryTokens` and handles truncation internally. This keeps the assembler responsible for its own output integrity, consistent with its role as the prompt construction layer.

### Truncation prefers line boundaries
When truncating, the code finds the last `\n` in the truncated text and cuts there. This prevents mid-line cuts and keeps the output readable.

### Disabled-by-envVar
`MEMORY_INJECTION_ENABLED=false` env var provides a kill switch without code changes. Useful for debugging or when memory injection needs to be temporarily disabled in production.

---

## 🧪 Verification

### TypeScript build
```
npx tsc --noEmit  →  Exit 0, zero errors ✅
```

### Logic flow (manual trace)
```
1. config.memory.enabled = true  → memories fetched
2. config.memory.enabled = false → memories = [], taskSummary = undefined
3. memories = []                  → taskSummary = undefined, no change to v1
4. memories.length > 0           → taskSummary built, injected into prompt
5. section tokens > 750          → truncation fires, text reduced
```

---

## 🚫 Non-Goals (Not Done)
- Auto-extracting memories from chat history → future work
- Priority beyond importance score → future work
- Memory lifecycle beyond CRUD → handled by MC-002

---

## 🔗 Downstream Dependencies
- `MemoryEntryRepo.getTopForUser()` — MC-001 ✅
- `assemblePrompt()` interface — FC-004 ✅
- `manageContext()` systemPrompt param — FC-004 ✅

No breaking changes to existing APIs. All extensions are backward-compatible additions.

---

## 📋 Deferred
- Integration test with real DB (requires `memory_entries` table to be created in DB)
- Automated unit test for truncation logic
