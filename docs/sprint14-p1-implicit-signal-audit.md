# Sprint 14 P1：B 层用户行为信号审计报告

**审计时间：** 2026-04-11
**审计人：** 蟹小钳 🦀
**状态：** ✅ 完成

---

## 一、FeedbackType 定义层审计

### 1.1 当前 FeedbackType 全量（7 种）

| 类型 | Score | 写入路径 | 触发方式 |
|---|---|---|---|
| `accepted` | 1 | ❌ **无前端路径** | 需手动上报 |
| `regenerated` | -2 | ⚠️ **无前端路径**，但有 auto-detect regex | auto-detect |
| `edited` | -0.5 | ❌ **无前端路径** | 需手动上报 |
| `thumbs_up` | 2 | ✅ MessageBubble 👍 | 用户点击 |
| `thumbs_down` | -2 | ✅ MessageBubble 👎 | 用户点击 |
| `follow_up_thanks` | 2 | ⚠️ **无前端路径**，有 auto-detect regex | auto-detect |
| `follow_up_doubt` | -1 | ⚠️ **无前端路径**，有 auto-detect regex | auto-detect |

### 1.2 三类信号现状

```
前端 UI 路径（显式）：  thumbs_up ✅ | thumbs_down ✅
Auto-detect 路径：     regenerated ✅ | follow_up_thanks ✅ | follow_up_doubt ✅
仅有定义（无写入路径）： accepted ❌ | edited ❌
```

**关键发现：** `accepted` 和 `edited` 在类型定义里存在，但没有任何写入路径，永远不会被触发。

---

## 二、前端事件源审计

### 2.1 当前前端可上报信号

前端目前只有 **1 个反馈入口**：

**MessageBubble.tsx**
- 👍 `thumbs_up` → `sendFeedback(decision.id, "thumbs_up")`
- 👎 `thumbs_down` → `sendFeedback(decision.id, "thumbs_down")`

这两个按钮只在 assistant 消息气泡下方出现，绑定到该条决策的 `decision.id`。

### 2.2 缺失的用户行为信号采集

以下用户行为在产品上真实发生，但前端**完全没有采集**：

| 行为 | 说明 | 当前状态 |
|---|---|---|
| 用户重发同一问题 | "再说一遍"意图 | ❌ 不采集 |
| 用户复制回答 | 可能觉得有用 | ❌ 不采集 |
| 用户编辑回答 | "这个答案我改一下" | ❌ 不采集（即使定义了 `edited` 类型） |
| 用户追问同一个 intent | follow-up 对话 | ❌ 不采集 |
| 用户跳过答案继续提问 | 答案不相关 | ❌ 不采集 |
| 会话时长 | 用户在答案上停留多久 | ❌ 不采集 |
| 输入框撤回/清空 | 用户删掉了已输入的 | ❌ 不采集 |
| 多轮追问 vs 单次终结 | 用户是否需要多轮 | ❌ 不采集 |

### 2.3 Auto-detect 的局限性

`detectImplicitFeedback()` 在每次 `learnFromInteraction()` 里用 regex 检测用户下一条消息：

```typescript
// backend/src/features/feedback-collector.ts
"谢谢|感谢|太好了|很好|完美|exactly|perfect|thanks|great|awesome" → follow_up_thanks
"你确定|不对|错了|不是这样|wrong|incorrect|are you sure" → follow_up_doubt
"再说一遍|重新|换个说法|rephrase|try again" → regenerated
```

**局限性：**
- 只在"下一条消息"上触发（依赖 `previousDecisionId`）
- regex 误报率高："再说一遍"不一定代表上一条答案差，可能只是想换个风格
- 对话早期（无 `previousDecisionId`）完全失效
- 无法区分"感谢这条回答"和"感谢之前的交互"

---

## 三、后端写入路径审计

### 3.1 当前写入链路

```
前端 sendFeedback(type)
    ↓
POST /api/chat/feedback  (chatRouter.post("/feedback"))
    ↓
recordFeedback(decisionId, feedbackType)
    ↓
DecisionRepo.updateFeedback(id, feedbackType, score)
    ↓
UPDATE decision_logs SET feedback_type=$1, feedback_score=$2 WHERE id=$3
```

### 3.2 两个严重问题

**问题 1：`/api/feedback` 无类型校验**

```typescript
// backend/src/api/chat.ts line 334
feedback_type = body.feedback_type;  // 任何字符串都能写进去
```

`FeedbackType` 是 TypeScript 类型约束，但**运行时没有验证**。前端传任何值都不会报错，数据直接进 `feedback_type VARCHAR(50)` 列。可以伪造任何类型。

**问题 2：`decision_id` 归属校验缺失**

```typescript
const exists = await query(`SELECT id FROM decision_logs WHERE id=$1`, [decision_id]);
if (exists.rowCount === 0) return c.json({ error: "decision not found" }, 404);
```

只验证 decision_id 存在，不验证该 decision 是否属于当前用户。任何用户可以对任意 decision 写反馈。

### 3.3 事件写入目标表

所有反馈事件目前都写入 `decision_logs` 表：

```sql
decision_logs (
  feedback_type    VARCHAR(50),
  feedback_score   NUMERIC(4,1),
  ...
)
```

**设计缺陷：** 反馈是"单条决策的事件"，但每条反馈会**覆盖**同一 decision 的 feedback_type/feedback_score（UPDATE）。同一决策永远只有最后一次反馈被记录。

---

## 四、信号可靠性分级

### 4.1 分级原则

判断一个信号能否作为 satisfaction proxy，需要回答：
1. **因果性**：用户行为是否由本条答案引发？（而非随机、系统原因）
2. **排他性**：该行为是否只在该答案满足用户时才出现？
3. **可伪造性**：用户能否故意制造该信号？
4. **基准率**：该行为是否常见到无法区分个体差异？

### 4.2 当前信号的可靠性分级

| 类型 | 层级 | 可靠度 | 理由 |
|---|---|---|---|
| `thumbs_up` | **L1 强信号** | 高 | 用户主动、有明确意图；配合防刷可作 truth |
| `thumbs_down` | **L1 强信号** | 高 | 同上 |
| `follow_up_thanks` | **L2 弱证据** | 中 | regex 可能误报；"谢谢"可能泛指而非特指本条答案 |
| `follow_up_doubt` | **L2 弱证据** | 中 | 同上；"你确定吗"在复杂问题时是正常追问 |
| `regenerated` | **L3 噪声** | 低 | 用户可能为了换风格而非答案不好；重试不一定是负反馈 |
| `edited` | **L3 噪声** | 低 | 编辑可能是润色需求，而非对质量不满 |
| `accepted` | **不可用** | — | 无触发路径，未定义触发时机 |

### 4.3 永远不能作为 satisfaction 代理的信号

以下信号**无论采集多少量**，都不能用来定义用户满意度：

| 信号 | 禁因 |
|---|---|
| 输入框停留时长 | 系统性能/打字速度影响；与答案质量无关 |
| 复制行为 | 可能是抄给第三方，与满意度无关 |
| 会话结束时无负面操作 | 沉默 ≠ 满意，可能是放弃 |
| 快速发送下一条 | 用户急于继续，而非满意 |
| 用户没有追问 | 可能已满足，也可能已放弃 |

### 4.4 当前系统的 semantic gap

现在的问题是：**系统没有在信号层区分 L1/L2/L3**。

`analyzeAndLearn()` 对所有 `feedback_score != 0` 的样本一视同仁：

```typescript
// 所有有 score 的 decision 都进 positiveCount / negativeCount
if (score > 0) positiveCount++
if (score < 0) negativeCount++
```

这意味着：
- 一条 regex 误判的 `follow_up_doubt` 会影响 behavioral memory 的 learning
- 一条真正有 `thumbs_down` 的样本和一条 regex 误报会被平等对待

**这是 B 层信号的核心设计问题。**

---

## 五、架构设计方案

### 5.1 推荐：分层 feedback event 架构

```
用户行为事件
    ↓
前端事件采集层（新增 feedback-events.ts）
    ↓
POST /api/feedback/events（新增端点）
    ↓
feedback_events 表（新增）+ decision_logs（仅记录最终仲裁结果）
    ↓
Behavioral Learning（分层处理）
    ├── L1 强信号 → 直接影响正负 truth
    ├── L2 弱信号 → 只作 sample eligibility（P4.2 模式）
    └── L3 噪声 → 记录存档，不参与 learning
```

### 5.2 新增 `feedback_events` 表建议

```sql
CREATE TABLE IF NOT EXISTS feedback_events (
  id              VARCHAR(36) PRIMARY KEY,
  decision_id    VARCHAR(36) NOT NULL REFERENCES decision_logs(id),
  user_id        VARCHAR(36) NOT NULL,
  event_type     VARCHAR(50) NOT NULL,   -- 例如 "copy", "regenerate", "thumbs_up"
  signal_level   SMALLINT NOT NULL,      -- 1=L1, 2=L2, 3=L3
  raw_data       JSONB,                  -- 原始上下文
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 决策表只保留"已仲裁"的最终反馈（可选保留，简化现有逻辑）
-- 新系统下 decision_logs.feedback_score 变为 optional
```

### 5.3 前端需要新增的事件采集点

| 事件 | 采集方式 | 信号层级 |
|---|---|---|
| 用户点击"重新生成"按钮 | `handleRegenerate` 拦截 | L2 |
| 用户点击"复制回答" | `onCopy` 事件 | L3（不能作满意代理，但可作有用性弱信号） |
| 用户追问（同一 intent） | 对比 `history[-2].intent === history[-1].intent` | L2 |
| 用户放弃（超过 N 秒无操作） | `useEffect` + idle timer | L3（极不可靠） |
| 用户编辑了 AI 的回答 | 监听 AI message 的 `contentEditable` 变更 | L2 |
| 用户对某个按钮点击 | 热力图（未来方向） | L3 |

### 5.4 优先级建议

**Phase 1（立即可做，价值最高）：**
1. 修复 `/api/feedback` 身份校验（decision 归属验证）
2. 修复类型白名单校验（FeedbackType enum 运行时验证）
3. `thumbs_up`/`thumbs_down` 写入 `feedback_events` 表

**Phase 2（下一 Sprint）：**
4. 新增 `feedback_events` 表（区分 signal_level）
5. 前端新增 regenerate / edited 事件采集
6. `analyzeAndLearn()` 接入 signal_level 过滤

**Phase 3（未来方向）：**
7. 前端新增 copy / follow-up 追问事件采集
8. Dashboard 展示 feedback event 热力图

---

## 六、结论

### 6.1 审计核心发现

**现状：**
- FeedbackType 定义 7 种，只有 **2 种有真实写入路径**（thumbs_up / thumbs_down）
- 反馈事件全部落在 `decision_logs`（单条 UPDATE），无事件溯源
- `/api/feedback` 无类型校验、无归属校验，可伪造
- L1/L2/L3 信号混合处理，regex 误报会污染 learning truth

**B 层信号的真实容量：**
- 当前 B 层信号约等于零（auto-detect 3 种 + thumbs 2 种，但 auto-detect 精度低）
- 前端用户行为层完全没有基础设施
- `follow_up_thanks` / `follow_up_doubt` 这两个名字看起来像 implicit signal，但只是 regex 匹配，不是真正的用户行为采集

**Sprint 14 P1 的真正产出：**
不是"实现 implicit feedback"，而是**把 B 层信号基础设施从零建起来**——先定义事件类型、分级、写入路径，再谈 learning 接入。

### 6.2 是否需要新表？

**结论：建议新增 `feedback_events` 表。**

理由：
- `decision_logs` 是每条决策的事实表，不应混入细粒度事件
- feedback event 是"发生在决策上的事件"，一对多关系
- 如果只在 `decision_logs` 上 UPDATE，就永远丢失了"用户多次反馈"的历史
- 分层处理（L1/L2/L3）需要 signal_level 字段，decision_logs 不适合承载

### 6.3 Sprint 14 P1 交付物定义

```
审计报告（本文件）✅
├── FeedbackType 全量审计表
├── 前端事件源清单（已有 + 缺失）
├── 后端写入路径审计（风险点）
├── 信号可靠性分级（L1/L2/L3/禁用）
├── 新表 schema 草案（feedback_events）
└── Phase 1/2/3 优先级建议
```

---
_横行天下，一钳定乾坤。_
