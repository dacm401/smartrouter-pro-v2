/**
 * Sprint 48: Auth v1 — JWT Token Endpoint
 *
 * POST /auth/token
 * Body: { "username": "admin", "password": "secret" }
 * Returns: { "token": "<jwt>", "expires_in": 86400 }
 *
 * 凭证由 AUTH_USERS 环境变量提供（格式: user:pass,user2:pass2）。
 * 生产环境必须设置 JWT_SECRET。
 */

import { Hono } from "hono";
import { SignJWT, importPKCS8 } from "jose";
import { config } from "../config.js";

const authRouter = new Hono();

const isProduction = process.env.NODE_ENV === "production";

// In-memory user store parsed from AUTH_USERS env var
// Format: "user1:pass1,user2:pass2"
function parseUsers(): Map<string, string> {
  const raw = process.env.AUTH_USERS;
  if (!raw) {
    if (isProduction) {
      throw new Error(
        "[AUTH-SEC] AUTH_USERS environment variable is required in production. " +
        "Format: 'user:pass,user2:pass2'. Do NOT ship with hardcoded credentials."
      );
    }
    // Dev-only fallback — never reaches production
    console.warn("[AUTH-SEC] AUTH_USERS not set. Using insecure dev default. DO NOT use in production.");
    return new Map([["admin", "changeme"]]);
  }
  const users = new Map<string, string>();
  for (const entry of raw.split(",")) {
    const [username, password] = entry.trim().split(":");
    if (username && password) {
      users.set(username, password);
    }
  }
  return users;
}

const TOKEN_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

async function signToken(userId: string): Promise<string> {
  // P0-2: JWT secret 由 config.ts 提供，config.ts 已在 startup 校验长度
  const secret = new TextEncoder().encode(config.jwt.secret);
  const alg = "HS256";

  const jwt = await new SignJWT({ sub: userId })
    .setProtectedHeader({ alg })
    .setIssuedAt()
    .setExpirationTime(`${TOKEN_EXPIRY_SECONDS}s`)
    .sign(secret);

  return jwt;
}

authRouter.post("/token", async (c) => {
  let body: { username?: string; password?: string };
  try {
    const rawBody = await c.req.raw.text();
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { username, password } = body ?? {};

  if (!username || !password) {
    return c.json({ error: "username and password are required" }, 400);
  }

  const users = parseUsers();
  const storedPassword = users.get(username);

  if (!storedPassword || storedPassword !== password) {
    // 延迟响应：防止Timing Attack
    await new Promise((r) => setTimeout(r, 50));
    return c.json({ error: "Invalid credentials" }, 401);
  }

  const token = await signToken(username);

  return c.json({
    token,
    expires_in: TOKEN_EXPIRY_SECONDS,
    token_type: "Bearer",
  });
});

export { authRouter };
