/**
 * C3a: Server Identity Context Adapter
 *
 * Unified identity extraction layer for all API handlers.
 *
 * Priority:
 *   1. X-User-Id header  → trusted, server-injected
 *   2. query.user_id     → dev fallback only (when ALLOW_DEV_FALLBACK=true)
 *   3. body.user_id      → NOT read here; chat/feedback handlers use a
 *                          dev-only compatibility shim in-place instead
 *   4. None              → 401
 *
 * The middleware never parses JSON body (constraint: no body reading in middleware).
 * For chat/feedback endpoints that traditionally receive user_id in body,
 * a dev-only inline shim is provided in the handlers themselves (see chat.ts).
 */

import type { Context, Next } from "hono";
import { config } from "../config.js";

// The type for the userId context variable — import this in API handlers
// to properly type `c.get("userId")`.
export type UserIdContext = { userId: string | undefined };

/**
 * Reads userId from the request context that was set by identityMiddleware.
 * Returns the trusted userId string, or undefined if not set.
 *
 * Usage in handlers:
 *   const userId = getContextUserId(c);
 *   // Handle undefined case if the endpoint doesn't require mandatory auth.
 */
export function getContextUserId(c: Context): string | undefined {
  // Hono stores context vars in a private Map via c.set/c.get
  // c.get("userId") reads from that Map; direct property access (c as any).userId does NOT work
  return c.get("userId") as string | undefined;
}

/**
 * Middleware: extracts identity from trusted sources and writes to context.
 *
 * On success:  c.set("userId", userId) → next()
 * On failure:  401 JSON response
 */
export async function identityMiddleware(c: Context, next: Next): Promise<Response | void> {
  // Priority 1: server-injected header (trusted)
  const headerUserId = c.req.header("X-User-Id");
  if (headerUserId) {
    c.set("userId", headerUserId);
    return next();
  }

  // Priority 2: query.user_id (dev fallback only)
  const queryUserId = c.req.query("user_id");
  if (queryUserId) {
    if (config.identity.allowDevFallback) {
      c.set("userId", queryUserId);
      return next();
    }
    // Dev fallback disabled → treat as unauthenticated in production path
    return c.json({ error: "Authentication required: provide X-User-Id header" }, 401);
  }

  // Priority 3: no identity found
  // body.user_id is NOT read here (middleware constraint).
  // For chat/feedback endpoints that need body compatibility in dev mode,
  // handlers perform their own inline shim (see chat.ts).

  // Reject immediately in production mode
  if (!config.identity.allowDevFallback) {
    return c.json({ error: "Authentication required: provide X-User-Id header" }, 401);
  }

  // Dev fallback enabled but no identity in header/query.
  // Leave context unset and pass through — handlers that need identity
  // will use their own dev-only inline shim.
  return next();
}
