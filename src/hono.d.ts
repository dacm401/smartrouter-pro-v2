/**
 * C3a: Hono Context type augmentation
 *
 * Registers the `userId` variable set by identityMiddleware into Hono's
 * ContextVariables interface so that `c.get("userId")` returns `string | undefined`
 * instead of `unknown` throughout the codebase.
 */
import "hono";

declare module "hono" {
  interface ContextVariables {
    userId: string | undefined;
  }
}
