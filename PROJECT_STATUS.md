# PROJECT_STATUS.md — SmartRouter Pro 交付状态

> 版本：v1.0.0 | 日期：2026-04-11 | 状态：✅ Phase B COMPLETE

---

## 项目定位

SmartRouter Pro 是一个 **Lean Agent Runtime（LAR）** 系统——默认保持轻量级对话交互，仅在必要时升级为 Agent 行为。核心单元是 **Task**，而非原始消息历史。

设计哲学：可控制性优于能力 → 显式优于隐式 → 稳定架构优先，快速生成其次。

---

## 版本与完成度

### 当前版本：v1.0.0（Phase B COMPLETE ✅）

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

**Phase A（Lean Chat Runtime）：** ✅ COMPLETE
**Phase B（Research Runtime）：** ✅ COMPLETE
**Phase C（Execution Runtime）：** 待开
**Phase D：** 可选项

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

- **无生产认证系统**：依赖 `X-User-Id` header；dev 模式可通过 `ALLOW_DEV_FALLBACK=true` 从 body 读取 user_id（生产环境勿开启）
- **Feedback dual-write**：特殊时序下（`feedback_events` 成功 + `decision_logs` 失败）存在短暂表间不一致
- **Evidence 来源**：仅 web_search 自动写入；http_request/manual 来源待后续补充
- **Task Resume**：仅支持跨 session 续接同一 task；不支持多人协作
- **Benchmark**：需要真实 backend 运行才能产生 pass 结果；当前 CI 无 benchmark job
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

---

## 下一步（Phase C 可选项）

| 优先级 | 卡片 | 描述 |
|--------|------|------|
| P1 | C3（Server Identity Context）治理 | Token/session 系统，完整 auth |
| P2 | Evidence Layer 6 完整性 | http_request/manual evidence 来源 |
| P3 | Benchmark CI Job | 在 GitHub Actions 中加入 benchmark |
| P4 | Memory UI 面板 | 前端 Memory 管理界面 |
