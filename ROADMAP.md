# SmartRouter Pro — Roadmap 2026-04-22

> 本文档整合以下来源的待办事项，经代码核查确认实际状态
> - Sprint_Report_20260418_LLM_Native_Routing.docx（04-18）
> - docs/GATED-DELEGATION-v2.md（Phase D 规划）
> - PROJECT_STATUS.md（v1.1.0 当前状态）
> - 代码核查结果（src/types/index.ts / schema.sql / llm-native-router.ts 等）

---

## 版本与阶段概览

| 阶段 | 主题 | 状态 | 里程碑 Commit |
|------|------|------|--------------|
| Phase A | Lean Chat Runtime | ✅ COMPLETE | Sprint 08 |
| Phase B | Research Runtime | ✅ COMPLETE | Sprint 16 |
| Phase C | Execution Runtime | ✅ COMPLETE | `v1.1.0` (2026-04-21) |
| **Phase D** | **Intelligent Routing Runtime** | ⏳ **开发中** | Sprint 50 ✅ / Sprint 51→ |
| Phase E | 可选项 | 📋 待定 | — |

---

## Phase D: Gated Delegation Architecture v2

> 核心目标：把 Manager→Worker 委托判断从"单动作硬判"升级为"多动作打分 + 置信度校准 + 反馈学习"

### Gated Delegation 四层完成度

| 层 | 名称 | 状态 | 关键文件 | Sprint |
|----|------|------|----------|--------|
| **G1** | Action Score Head | ✅ DONE | `llm-native-router.ts`（ManagerDecisionV2）/ `manager-prompt.ts` | Sprint 50 |
| **G2** | Policy-Calibrated Gate | ✅ DONE | `hard-policy.ts` / `gating-config.ts` | Sprint 50 |
| **G3** | Rerank-on-Uncertainty | ✅ DONE | `delegation-reranker.ts` / `knowledge-boundary-signals.ts` | Sprint 50 |
| **G4** | Delegation Learning Loop | ⏳ **TODO** | `delegation_logs` 事实表 / 日志写入 pipeline | Sprint 51→ |

---

## Sprint 51 规划：双轨并行（Gap 收口 + G4 学习闭环）

> ⚠️ **Gap Analysis 结论**：Phase D G1/G2/G3 已完成，但整体存在 3 个 P0 缺口和 5 个 P1 缺口。
> Sprint 51 必须双轨并行：**G4 学习闭环**（原计划）+ **测试覆盖收口**（gap P0）。

### 轨道 A — G4 Delegation Learning Loop（原计划 P0）

| 卡片 | 描述 | 关键交付物 |
|------|------|-----------|
| **G4-A** | `delegation_logs` 决策事实表设计 + SQL Migration | `migrations/0XX_delegation_logs.sql` |
| **G4-B** | 日志写入 Pipeline | `services/delegation-logger.ts`（fire-and-forget） |
| **G4-C** | Benchmark 适配新 Schema | `benchmark-routing.cjs` 更新 |
| **G4-D** | vitest 覆盖 + tsc 全绿 + commit + push | 完整 Sprint 收口 |

**delegation_logs 最小字段集**（来自 GATED-DELEGATION-v2.md）：
- `id / user_id / session_id / task_id / timestamp`
- `query_text / query_features_json`
- `llm_scores_json / llm_confidence_hint / system_confidence`
- `selected_action / final_action_after_policy`
- `rerank_triggered / rerank_reason`
- `policy_adjustments_json`
- `selected_worker_type / archive_id / command_id`
- `latency_ms / input_tokens / output_tokens / total_cost_usd`
- **四层成功标准**：`routing_success / execution_success / value_success / user_success`
- `feedback_source / notes_json`

### 轨道 B — 测试覆盖收口（Gap P0）

| 卡片 | 描述 | 关键文件 | 背景 |
|------|------|----------|------|
| **T-ORCH** | `orchestrator.ts` 单元测试 | `tests/services/orchestrator.test.ts` | 核心编排逻辑无任何测试 |
| **T-LLM-NAT** | `llm-native-router.ts` 单元测试 | `tests/services/llm-native-router.test.ts` | Gated Delegation 核心函数缺单元测试 |
| **T-P4** | Phase 4 redaction/permission 单元测试 | `tests/services/phase4/` | redactor/permission 代码已实现但无测试 |

### 轨道 C — 配置安全收口（Gap P1，并行可做）

| 卡片 | 描述 | 关键文件 | 背景 |
|------|------|----------|------|
| **CFG-SEC** | JWT secret 启动校验 + Redis dead code 清理 | `config.ts` | JWT 默认空字符串，Redis 配置无连接代码 |

---

## Sprint 52 规划：Phase D 闭环 + P1 Gap 补全

> 背景：Sprint 51 G4 + 测试覆盖完成后，Phase D 核心闭环完成。Sprint 52 承接所有 P1 gap 剩余项。

### P1 — 测试覆盖补全（gap 延续）

| 卡片 | 描述 | 关键文件 | 背景 |
|------|------|----------|------|
| **T-P5** | Phase 5 存储后端单元测试 | `tests/services/phase5/storage-backend.test.ts` | local/s3/pg 三种实现无测试 |
| **T-ERR** | fire-and-forget 静默吞错 → console.warn | 各 `.catch()` 处 | 非关键路径静默失败应改为 warn 日志 |

### P1 — Memory / Evidence 效果增强

| 卡片 | 描述 | 当前状态 |
|------|------|----------|
| **E1** | `intent-aware category boost` | 🟡 基础 Evidence fire-and-forget 已实现（`evidence-repo.ts`），但未按 intent category 区分权重 |
| **E2** | `retrieveEvidenceForContext()` 按上下文智能召回 | ⏳ TODO — 目前是 keyword 检索，未考虑语义/意图 |

**前置依赖**：G4 完成（四层成功数据反馈后才知道哪类任务最缺 evidence）

### P1 — Slow 模型只读 Prompt 最终版

| 卡片 | 描述 | 当前状态 |
|------|------|----------|
| **S1** | `worker-prompt.ts` 全面重写为只读 Task Brief | 🟡 部分实现 — `task_brief` JSONB 字段已存在（schema.sql line 264），但 worker prompt 优化待正式 review |

**前置依赖**：G4 的 `routing_success / execution_success` 数据反馈后才知道当前 prompt 的真实瓶颈在哪

### P2 — SSE 协议扩展

| 卡片 | 描述 | 当前状态 |
|------|------|----------|
| **SSE1** | SSE `done` 事件双路推送（Fast 直推路径 / delegation 路径） | 🟡 部分实现 — SSE 事件框架在用，但 done 事件两路分发逻辑待验证 |
| **SSE2** | `SSEEvent` 类型统一 `stream` 字段 | ⏳ TODO — 当前各路径 SSE 类型分散 |

### P3 — Phase 2.0 完整流量分级上线

| 卡片 | 描述 | 当前状态 |
|------|------|----------|
| **L2** | Layer 0/1/2 全量上线 | ⏳ 规划中 |
| **L2-B** | Benchmark 扩测（覆盖 Layer 2 复杂任务） | ⏳ 依赖 G4 数据 |
| **L2-C** | 基于 G4 数据做 router 微调 | ⏳ 依赖 G4 + L2-B |

### P3 — 产品化 Polish

| 卡片 | 描述 | 当前状态 |
|------|------|----------|
| **UI1** | 前端 SSE 事件渲染优化 | ⏳ 规划中 — SSE 事件已接入，但 `clarifying` / `done` 等新事件类型的前端渲染待完善 |
| **UI2** | 前端 TracePanel / EvidencePanel polish | 🟡 基础已有，细节待优化 |

### P5 — Intent 准确率持续优化（远期）

> 最终目标：Rule Router → LLM-Native Router 完整替代

| 卡片 | 描述 | 当前状态 |
|------|------|----------|
| **I1** | Intent classifier 基于 G4 四层成功数据持续调优 | ⏳ 依赖 G4 |
| **I2** | LLM-Native Routing 替代规则路由（Benchmark 97%→99%） | ⏳ 依赖 I1 |

---

## 技术债务（未清理）

> 来自 Sprint Report 04-18 技术债务节 + git status 残留

| 卡片 | 描述 | 优先级 | 备注 |
|------|------|--------|------|
| **TD1** | vitest pool 配置 / NODE_PATH / test:repos 脚本 | P2 | 已知在 backlog |
| **TD2** | 集成测试 harness helpers（`initTestDb` / `withTestUser` / `withTestTask`） | P2 | `task-resume.test.ts` 5 tests skipped |
| **TD3** | `evidence-repo.test.ts` / `task-resume.test.ts` await 修复 | P2 | 已在 v1.1.0 前处理部分 |
| **TD4** | 临时测试文件清理（`p4_result.txt` / `test-chat.ps1` 等） | P3 | 建议统一清理 |

---

## 04-18 Docx 待办状态确认表

| Docx 待办（04-18） | 原优先级 | 最终状态 | 备注 |
|--------------------|---------|---------|------|
| Phase 1.5 任务卡片 Schema 实现 | P0 | ✅ **已实现** | `task_brief JSONB` + GIN index 已落地 |
| Phase 1.5 Clarifying 流程 | P0 | ✅ **已实现** | `ClarifyQuestion` interface + orchestrator 使用 + E2E 测试 |
| Phase 1.5 Slow 模型只读优化 | P0 | 🟡 **部分实现** | `task_brief` 字段存在，prompt 正式 review 待做 |
| Memory/Evidence 效果增强 | P1 | 🟡 **部分实现** | fire-and-forget 已实现，intent-aware boost 待 G4 后做 |
| SSE done 事件 + 类型扩展 | P2 | ⏳ **待做** | SSE 框架已有，done 双路分发待实现 |
| Phase 2.0 完整流量分级上线 | P3 | ⏳ **规划中** | 排入 Sprint 52+ |
| 产品化 polish（前端） | P3 | ⏳ **规划中** | 排入 Sprint 52+ |

---

## Sprint 里程碑路线图

```
2026-04-18  Sprint Report → Phase 1.5 P0 三项 + P1/P2/P3 待办
               │
2026-04-21     │  Phase C COMPLETE (v1.1.0) ✅
               │
2026-04-22     │  Sprint 50 COMPLETE ✅  G1/G2/G3 全链路 + E2E 测试
               │  → Phase 1.5 P0 三项已通过 G1/G2/G3 实现覆盖
               │
Sprint 51 →    │  双轨并行 ⏳
               │  轨道A: G4 delegation_logs + 日志 pipeline
               │  轨道B: T-ORCH + T-LLM-NAT + T-P4 测试覆盖
               │  轨道C: CFG-SEC JWT/Redis 安全收口
               │
Sprint 52+ →   │  Phase D 闭环 + P1 gap 补全
               │  T-P5: Phase 5 存储后端测试
               │  T-ERR: fire-and-forget → warn 日志
               │  E1/E2: Evidence intent-aware boost
               │  S1:   Slow prompt 最终版 review
               │  SSE1/2: SSE done 双路 + stream 字段
               │  L2:   Layer 2 全量上线
               │
远期 →          │  P5: Intent 准确率持续优化（97%→99%）
               │  Phase E: 可选项
```

---

*横行天下，一钳定乾坤 🦀*
*最后更新：2026-04-22（v1.1.2-rc: Sprint 51 双轨规划 + Gap P0/P1 正式排入）*
