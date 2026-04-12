import { Hono } from "hono";
import { calculateDashboard } from "../logging/metrics-calculator.js";
import { GrowthRepo, DecisionRepo } from "../db/repositories.js";
import { getContextUserId } from "../middleware/identity.js";
import { calcBaselineCost } from "../config/pricing.js";

const dashboardRouter = new Hono();

// C3a: userId now comes from middleware context (trusted source), not path param.
// The :userId path segment is no longer used for identity.
dashboardRouter.get("/dashboard/:userId", async (c) => {
  // C3a: read from middleware context
  const userId = getContextUserId(c)!;
  try {
    const data = await calculateDashboard(userId);
    return c.json(data);
  } catch (error: any) {
    console.error("Dashboard error:", error);
    return c.json({ error: error.message }, 500);
  }
});

dashboardRouter.get("/growth/:userId", async (c) => {
  // C3a: read from middleware context (middleware always sets userId for /v1/* routes)
  const userId = getContextUserId(c)!;
  try {
    const profile = await GrowthRepo.getProfile(userId);
    return c.json(profile);
  } catch (error: any) { return c.json({ error: error.message }, 500); }
});

dashboardRouter.get("/cost-stats/:userId", async (c) => {
  const userId = getContextUserId(c)!;
  try {
    const stats = await DecisionRepo.getCostStats(userId);
    return c.json(stats);
  } catch (error: any) {
    console.error("Cost stats error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export { dashboardRouter };
