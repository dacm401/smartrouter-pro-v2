import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { config } from "./config.js";
import { identityMiddleware } from "./middleware/identity.js";
import { chatRouter } from "./api/chat.js";
import { dashboardRouter } from "./api/dashboard.js";
import { taskRouter } from "./api/tasks.js";
import { memoryRouter } from "./api/memory.js";
import { evidenceRouter } from "./api/evidence.js";
import { healthRouter } from "./api/health.js";
import { archiveRouter } from "./api/archive.js";
// Phase 3.0: 启动后台 Worker 轮询循环
import { startSlowWorker } from "./services/phase3/slow-worker-loop.js";
import { startExecuteWorker } from "./services/phase3/execute-worker-loop.js";

const app = new Hono();

app.use("/*", cors());
// C3a: mount identity middleware on all API routes
app.use("/api/*", identityMiddleware);
app.use("/v1/*", identityMiddleware);
// H1: Runtime Health Dashboard — public, no identity middleware
app.route("/health", healthRouter);
app.route("/api", chatRouter);
app.route("/api", dashboardRouter);
app.route("/v1/tasks", taskRouter);
app.route("/v1/memory", memoryRouter);
app.route("/v1/evidence", evidenceRouter);
app.route("/v1", archiveRouter);

console.log(`
╔══════════════════════════════════════════╗
║     SmartRouter Pro v1.0               ║
║     透明的、会成长的 AI 智能运行时       ║
║     Port: ${config.port}                          ║
╚══════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: config.port });

// Phase 3.0: 启动后台 Worker（独立轮询循环，不阻塞 HTTP 请求）
startSlowWorker();
startExecuteWorker();
