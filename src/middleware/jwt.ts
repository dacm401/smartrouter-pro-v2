/**
 * Sprint 48: Auth v1 — JWT Verification Middleware
 *
 * Verifies Bearer token from Authorization header.
 * On success, sets c.set("userId", userId).
 *
 * Does NOT block requests — it only parses the token and sets context.
 * Downstream handlers decide whether to require authentication.
 */

import type { Context, Next } from "hono";
import { jwtVerify, importPKCS8 } from "jose";
import { config } from "../config.js";

const JWT_ALGORITHM = "HS256";

/**
 * Extracts and verifies a JWT from the Authorization header.
 * Returns the userId (sub claim) on success, null on failure.
 */
export async function verifyJwt(authHeader: string | undefined): Promise<string | null> {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  if (!token) return null;

  // P0-2: JWT secret 由 config.ts 提供，config.ts 已在 startup 校验长度
  const secret = new TextEncoder().encode(config.jwt.secret);

  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: [JWT_ALGORITHM] });
    // sub claim = userId
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

/**
 * JWT middleware: parses Bearer token and writes userId to context.
 * Silently passes through on failure (does not block — let handlers decide).
 */
export async function jwtMiddleware(c: Context, next: Next): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  const userId = await verifyJwt(authHeader);

  if (userId) {
    c.set("userId", userId);
  }

  return next();
}
