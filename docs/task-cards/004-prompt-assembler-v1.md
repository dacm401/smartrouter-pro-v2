# Feature Card 004: PromptAssembler v1

## Goal
Extract prompt construction from ChatService into a dedicated PromptAssembler module.

---

## Scope

### Must Support
- direct mode prompt assembly
- research mode prompt assembly

### Prompt Sections
- core_rules
- mode_policy
- task_summary (optional for now)
- user_request

### Includes
- PromptAssembler service/module
- prompt input type
- prompt output type
- ChatService integration
- no behavior regression for existing POST /api/chat

---

## Non-Goals

- memory injection
- evidence injection
- token budgeting logic
- prompt debugging endpoint
- execute mode prompt composition

---

## Acceptance Criteria

- ChatService no longer manually builds prompt strings inline
- prompt structure is explicit and reusable
- direct and research mode both produce valid prompts
- existing chat flow still works

---

## Suggested Design

### Input
- mode
- userMessage
- optional task summary
- optional constraints

### Output
- systemPrompt
- userPrompt
- sections metadata

---

## Test Steps

1. send a direct-style chat request via POST /api/chat
2. verify response still works
3. send a research-style chat request
4. verify research mode still works
5. inspect code and confirm prompt logic is extracted
6. optionally log assembled sections for debug

---

## Review Checklist

- is prompt logic centralized?
- are prompt sections explicit?
- is ChatService now thinner?
- is the implementation future-friendly for memory/evidence injection?
