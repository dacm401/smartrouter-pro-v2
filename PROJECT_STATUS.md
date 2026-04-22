# PROJECT_STATUS.md — SmartRouter Pro 交付状态

> 版本：v1.1.2-rc | 日期：2026-04-22 | 状态：⏳ Sprint 51 规划中

## 完整 Roadmap
详见 `ROADMAP.md`（本文档仅记录当前状态）

### Phase D: Gated Delegation v2 完成度

| 层 | 名称 | 状态 | Sprint |
|----|------|------|--------|
| G1 | Action Score Head | ✅ DONE | Sprint 50 |
| G2 | Policy-Calibrated Gate | ✅ DONE | Sprint 50 |
| G3 | Rerank-on-Uncertainty | ✅ DONE | Sprint 50 |
| G4 | Delegation Learning Loop | ⏳ TODO | Sprint 51→ |

---

## 项目定位

SmartRouter Pro 是一个 **Lean Agent Runtime（LAR）** 系统——默认保持轻量级对话交互，仅在必要时升级为 Agent 行为。核心单元是 **Task**，而非原始消息历史。

设计哲学：可控制性优于能力 → 显式优于隐式 → 稳定架构优先，快速生成其次。

---

## 版本与完成度

### 当前版本：v1.1.0（Phase C COMPLETE ✅）

| LAR 层 | 描述 | 状态 |
|--------|------|------|
| Layer 1 | Task Runtime（任务创建/续接/追踪） | ✅ COMPLETE |
| Layer 2 | Intent & Complexity Classifier（9种意图/5因子复杂度） | ✅ COMPLETE |
| Layer 3 | Capability Router（14条加权规则/BH-driven/fallback） | ✅ COMPLETE |
| Layer 4 | Prompt Assembler（core_rules + mode_policy + task_summary） | ✅ COMPLETE |
| Layer 5 | Memory System + Retrieval Pipeline v2（MR-001~003/category-aware） | ✅ COMPLETE |
| Layer 6 | Execution Layer（EL-001~004状态机/tool_call/reasoning/synthesis） | ✅ COMPLETE |
| Layer 7 | Model Router（OpenAI + Anthropic 双 Provider） | ✅ COMPLETE |
| Layer 8 | Observability & Budget Control（全链路 trace/Growth/metrics） | ✅ COMPLETE |
| Layer 9 | API 规范（13个端点，含 CRUD + Dashboard + Growth） | ✅ COMPLETE |
| Layer 10 | Task Summary Engine（结构化摘要/跨会话续接） | ✅ COMPLETE |

### Gap Analysis：整体完整性风险（2026-04-22 全项目扫描）

> ⚠️ **背景**：Phase D G1/G2/G3 分支完善，但整体存在缺口。Sprint 51 须双轨并行。

| 维度 | 结论 | 关键发现 |
|------|------|---------|
| LAR 10层 | ✅ 全部实现，无缺失 | — |
| Phase A/B/C | ✅ COMPLETE | — |
| Phase D | 🟡 G1/G2/G3 DONE，G4 TODO | delegation_logs 事实表完全缺失，无法形成学习闭环 |
| API 层 | ✅ ~20个端点全部实现 | — |
| Storage/Repo 层 | ✅ 所有 Repository 方法完整 | — |
| Agent 层 | ✅ 6个工具全部实现，含 Guardrail | — |
| **测试覆盖** | 🔴 **3个 P0 缺口** | orchestrator.ts 无测试；llm-native-router 核心函数缺单元测试；Phase 4/5 无测试 |
| **错误处理** | 🟡 fire-and-forget 静默吞错 | 非关键路径的 `.catch()` 静默吞错，应改为 `console.warn` |
| **配置硬编码** | 🟡 JWT 默认空字符串，Redis dead code | 生产必须处理 |

**P0 缺口（阻塞学习闭环）**：
1. **G4 Delegation Learning Loop** — `delegation_logs` 事实表 + 日志 pipeline 完全缺失
2. **orchestrator.ts 单元测试** — 核心编排逻辑无任何测试
3. **llm-native-router.ts 单元测试** — Gated Delegation 核心函数缺覆盖

**P1 缺口（影响稳定性）**：
4. Phase 4（redaction/permission）无测试
5. Phase 5 存储后端无测试
6. JWT secret 启动校验缺失
7. Redis 配置 dead code
8. fire-and-forget 静默吞错（部分 catch 块）

**详见**：`ROADMAP.md` Sprint 51 双轨规划

**Phase A（Lean Chat Runtime）：** ✅ COMPLETE
**Phase B（Research Runtime）：** ✅ COMPLETE
**Phase C（Execution Runtime）：** ✅ COMPLETE（Layer 3 Manager-Worker Runtime）
**Phase D（Intelligent Routing Runtime）：** ⏳ 规划中

> **Phase D 核心方向：Gated Delegation Architecture v2**
> 借鉴 MoE 门控思想，把 Manager-Worker 委托判断从"单动作硬判"升级为"多动作打分 + 置信度校准"。
> 详见 `docs/GATED-DELEGATION-v2.md`（规划中）
**Phase E：** 可选项

---

## 已实现功能清单

### Backend

| 模块 | 核心功能 |
|------|---------|
| **API Routes** | chat / tasks / memory / evidence / feedback / dashboard / growth / health |
| **Router** | analyzeAndRoute（intent/ complexity/ behavioral memory routing） |
| **Execution Loop** | EL-001~004（状态机/tool_call/reasoning/synthesis/GUARDRAIL abort） |
| **Tool System** | tool-registry / tool-executor / tool-guardrail（HTTP白名单/HTTPS-only/timeout/响应大小） |
| **web_search** | 真实接入（config endpoint / Bearer token / graceful error） |
| **Memory** | MemoryEntryRepo CRUD + v2 retrieval pipeline（MR-001~003） |
| **Evidence** | EvidenceRepo + fire-and-forget 写入（web_search provenance） |
| **Learning** | analyzeAndLearn / Behavioral Memory / Growth Profile / satisfaction_rate 分层 |
| **Feedback** | explicit（L1/L2/L3 signal）/ implicit / dual-write 一致性 |
| **Identity** | Server Identity Context（C3a：X-User-Id → middleware → context） |

### Frontend

| 组件 | 功能 |
|------|------|
| ChatInterface | 对话界面，支持 execute 模式 |
| TaskPanel | 任务列表 + 状态 |
| EvidencePanel | evidence 查看（source icon + content 截断 + URL） |
| TracePanel | 链路 trace（分类图标 + detail 摘要） |
| HealthPanel | 健康状态（第4个tab，30s auto-refresh） |

### Testing & Infra

| 工具 | 用途 |
|------|------|
| `npm run test:r1` | R1 Mock 测试（35 tests：chat/evidence/tasks/chat-execute） |
| `npm run test:repos` | Repo 集成测试（带 PostgreSQL service） |
| `npm run benchmark` | Benchmark Runner v2（CLI args / 30s timeout / latest.json） |
| Docker Compose | 全链路可部署（postgres/backend/frontend） |
| GitHub Actions CI | R1 + repo + frontend tsc 三 job |

---

## 已知限制

- **JWT Auth**：生产建议更换 JWT_SECRET 为强随机密钥，JWT 库已集成（jose）；凭证由 `AUTH_USERS` 配置
- **Feedback dual-write**：特殊时序下（`feedback_events` 成功 + `decision_logs` 失败）存在短暂表间不一致
- **Evidence 来源**：仅 web_search 自动写入；http_request/manual 来源待后续补充
- **Task Resume**：仅支持跨 session 续接同一 task；不支持多人协作
- **Benchmark CI**：离线规则路由 65 条用例，Mode>=80% / Intent>=70%；本地用 `npm run benchmark:ci --prefix backend`；GitHub Actions 已集成 benchmark-routing job
- **Docker 验证**：docker-compose.yml 已正确编写，但需要 Docker daemon 实际运行才能 live 验证

---

## 快速启动（3步）

### 方式一：本地开发

```bash
# 1. 安装依赖
cd backend && npm install
cd ../frontend && npm install

# 2. 配置环境变量
cp backend/.env.example backend/.env
# 编辑 .env，填入 OPENAI_API_KEY 等

# 3. 启动
# Terminal 1:
cd backend && npm run dev

# Terminal 2:
cd frontend && npm run dev
```

### 方式二：Docker 部署

```bash
# 1. 启动全链路
docker compose up -d

# 2. 验证
curl http://localhost:3001/health

# 3. 访问前端
open http://localhost:3000
```

### 数据库初始化（如不使用 Docker）

```bash
docker run -d --name smartrouter-db \
  -e POSTGRES_DB=smartrouter \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -p 5432:5432 \
  postgres:15-alpine

docker exec -i smartrouter-db psql -U postgres -d smartrouter \
  < backend/src/db/schema.sql
```

---

## 测试命令

```bash
# R1 Mock 测试（无需 DB）
npm run test:r1 --prefix backend

# Repo 集成测试（需要 PostgreSQL）
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smartrouter_test \
  npm run test:repos --prefix backend

# Benchmark CI（离线规则路由器，无需 backend 运行）
npm run benchmark:ci --prefix backend

# Benchmark（需要 backend 运行）
npm run benchmark --prefix backend

# TypeScript 编译检查
npm run build --prefix backend
npm run build --prefix frontend
```

---

## Sprint 历史

| Sprint | 主题 | 状态 |
|--------|------|------|
| Sprint 01–08 | 核心架构搭建（Router/Executor/PromptAssembler/Memory） | ✅ |
| Sprint 05 | Execution Loop EL-001~004（状态机/Guardrail/trace） | ✅ |
| Sprint 14 | Feedback Signal Audit + Hardening | ✅ |
| Sprint 15 | C3a + E1 + T1 + W1 + UI1 + B1 | ✅ |
| **Sprint 16 Phase B** | **H1 Health Dashboard + R1 Regression Pack + B2 Benchmark Runner** | **✅** |
| **Sprint 44** | **LLM-Native Routing Benchmark（B2）Baseline 建立** | **🔄** |
| **Sprint 48** | **Phase 3.0 补完 + E2E 验证 + Auth v1** | **✅** |
| **Sprint 49** | **P1 Benchmark CI / P2 Intent 调优 / P3 前端 JWT Auth** | **✅** |
| **Sprint 50** | **Gated Delegation v2: G1/G2/G3 + E2E 测试 + TS 修复** | **✅** |
| **v1.1.0** | **Phase C 封板 - Evidence Layer / Memory UI 完成 / 版本升级** | **✅** |
| **v1.1.1** | **Phase D Sprint 50 收口 - Gated Delegation v2 测试覆盖完成** | **✅** |
| **Sprint 51** | **双轨并行：G4 Learning Loop + T-ORCH/T-LLM-NAT/T-P4 + CFG-SEC** | **⏳ 规划中** |

---

## 下一步（详见 ROADMAP.md）

| 优先级 | 卡片 | 描述 | 状态 |
|--------|------|------|------|
| **P0** | ~~Phase 1.5 Clarifying 流程~~ | ~~task_brief JSONB + ClarifyQuestion 状态机~~ | ✅ G1/G2/G3 已覆盖 |
| **P0** | ~~Phase 1.5 Slow 只读 Prompt~~ | ~~task_brief 字段落地~~ | ✅ G1 已覆盖 |
| **P0** | **Sprint 51 G4-A~D** | `delegation_logs` 事实表 + 日志 pipeline | ⏳ Sprint 51 轨道A |
| **P0** | **Sprint 51 T-ORCH** | `orchestrator.ts` 单元测试 | ⏳ Sprint 51 轨道B |
| **P0** | **Sprint 51 T-LLM-NAT** | `llm-native-router.ts` 核心函数单元测试 | ⏳ Sprint 51 轨道B |
| P1 | **Sprint 51 T-P4** | Phase 4 redaction/permission 单元测试 | ⏳ Sprint 51 轨道B |
| P1 | **Sprint 51 CFG-SEC** | JWT secret 启动校验 + Redis dead code 清理 | ⏳ Sprint 51 轨道C |
| P1 | Sprint 52 T-P5 | Phase 5 存储后端测试 | Sprint 52+ |
| P1 | Sprint 52 T-ERR | fire-and-forget → console.warn | Sprint 52+ |
| P1 | Memory/Evidence 效果增强 | intent-aware boost + retrieveEvidenceForContext | 依赖 G4 数据 |
| P2 | SSE done 双路推送 + stream 字段 | SSEEvent 类型扩展 | Sprint 52+ |
| P3 | Phase 2.0 Layer 2 全量上线 | Benchmark 扩测 + router 微调 | Sprint 52+ |
| P5 | Intent 准确率持续优化 | LLM-Native Routing 97%→99% | 远期待定 |
