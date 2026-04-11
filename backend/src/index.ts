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

const app = new Hono();

app.use("/*", cors());
// C3a: mount identity middleware on all API routes
app.use("/api/*", identityMiddleware);
app.use("/v1/*", identityMiddleware);
app.get("/health", (c) => c.json({ status: "ok", version: "1.0.0" }));
app.route("/api", chatRouter);
app.route("/api", dashboardRouter);
app.route("/v1/tasks", taskRouter);
app.route("/v1/memory", memoryRouter);
app.route("/v1/evidence", evidenceRouter);

console.log(`
╔══════════════════════════════════════════╗
║     SmartRouter Pro v1.0               ║
║     透明的、会成长的 AI 智能运行时       ║
║     Port: ${config.port}                          ║
╚══════════════════════════════════════════╝
`);

serve({ fetch: app.fetch, port: config.port });
