# TA-001: ExecutionLoop Unit Tests — Review

**Task Card:** TA-001 (Sprint 06)
**Status:** ✅ Done
**Commit:** `efada92`

## What was done

1. **Vitest v4 环境搭建**
   - `vitest.config.ts`：globals=true, environment=node, coverage via v8
   - `package.json` scripts: `test`, `test:run`, `test:coverage`
   - `devDependencies`: vitest `^4.1.3`

2. **19 个测试用例覆盖 ExecutionLoop 状态机**
   - `tests/services/execution-loop.test.ts`

   | Case | Description | Status |
   |------|-------------|--------|
   | TA-001.1 | single synthesis step → final content | ✅ |
   | TA-001.2 | reasoning + synthesis in order | ✅ |
   | TA-001.3 | tool_call with no tool emissions | ✅ |
   | TA-001.4 | tool_call executes 1 tool, appends result | ✅ |
   | TA-001.5 | tool_call executes multiple tools in order | ✅ |
   | TA-001.6 | full pipeline: tool_call → reasoning → synthesis | ✅ |
   | TA-001.7 | step_cap abort at maxSteps | ✅ |
   | TA-001.8 | tool_cap abort at maxToolCalls | ✅ |
   | TA-001.9 | no_progress abort: 3 reasoning w/o tools | ✅ |
   | TA-001.9b | no_progress resets when tool_call emits tool | ✅ |
   | TA-001.10 | step error → abort, step status=failed | ✅ |
   | TA-001.11 | GuardrailRejection → outer catch aborts loop | ✅ |
   | TA-001.12 | toolExecutor re-throws GuardrailRejection | ✅ |
   | TA-001.13 | message accumulator grows with each step | ✅ |
   | TA-001.14 | LoopContext fields passthrough to executor | ✅ |
   | TA-001.15 | loop lifecycle traces written (4 event types) | ✅ |
   | TA-001.16 | reason=completed when all steps finish in limits | ✅ |
   | TA-001.17 | model defaults to gpt-4o when not specified | ✅ |
   | TA-001.18 | original plan object is not mutated (copy) | ✅ |
   | TA-001.19 | loop_end trace detail reflects actual reason+stats | ✅ |

3. **Bug fixes discovered and fixed during testing**

   **Bug 1: mock 路径错误**
   - 错误：`vi.mock("../src/tools/executor.js", ...)`
   - 正确：`vi.mock("../../src/tools/executor.js", ...)`
   - 影响：5个工具相关测试失败（executor 未被 mock，实际模块被调用）

   **Bug 2: step error 后 inner catch `break` 不退出外层 while 循环**
   - JS 中 `break` 只退出最近的 `try/catch`，外层 while 继续执行
   - 导致 regular error（DB failure 等）落入 outer "completed" 分支
   - 修复：`break` → `throw err`，统一由 outer catch 处理并设置 `reason="error"`

   **Bug 3: GuardrailRejection 传播链未闭合**
   - `executor.ts` 正确 re-throw GuardrailRejection
   - 但 `execution-loop.ts` inner catch 吞掉了（只有 `break`）
   - 修复同上：统一 `throw err`，outer catch 正确 abort 并设置 `reason="error"`

## Key Design Decisions

### Mock strategy: vi.hoisted() + 共享引用
Vitest v4 ESM 模式下，`vi.mock()` factories 在模块顶部被 hoist。用 `vi.hoisted(() => vi.fn())` 声明共享引用，让 factory 和测试代码访问同一个 mock 实例。

```typescript
const toolExecutorExecute = vi.hoisted(() => vi.fn<any>());
vi.mock("../../src/tools/executor.js", () => ({
  toolExecutor: { execute: (...args) => toolExecutorExecute(...args) },
}));
```

### Step error 统一 abort 策略
所有 step 错误统一通过 `throw err` 传播到 outer catch，outer catch 负责：
- 写 `loop_end` trace（reason=error）
- 调用 `buildResult` 时传入 `currentStepIndex + 1`（失败步骤计为 attempted）

这与 EL-004 设计一致：loop 是 fail-closed 的。

### completedSteps 语义（复用 MC-003 的修复）
- 成功路径：`currentStepIndex++` 在 `step.status = "completed"` 后立即执行
- 错误路径：outer catch 传入 `currentStepIndex + 1`（+1 表示该步骤尝试过）

## Files Changed

- `backend/package.json` — vitest devDependency + scripts
- `backend/vitest.config.ts` — new
- `backend/tests/services/execution-loop.test.ts` — new (19 cases)
- `backend/src/services/execution-loop.ts` — inner catch: `break` → `throw err`
