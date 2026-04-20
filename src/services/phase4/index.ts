/**
 * Phase 4 — Local Trust Gateway
 *
 * 数据分类 + 权限层 + 脱敏引擎 + 小模型守卫
 */

// ── Data Classification ─────────────────────────────────────────────────────────
export {
  DataClassifier,
  getDataClassifier,
} from "./data-classifier";

export {
  FEATURE_FLAGS,
  PermissionChecker,
  getPermissionChecker,
  quickPermissionCheck,
} from "./permission-checker";

// ── Redaction Engine ─────────────────────────────────────────────────────────────
export {
  RedactionEngine,
  getRedactionEngine,
  resetRedactionEngine,
} from "./redaction-engine";

// ── SmallModelGuard ─────────────────────────────────────────────────────────────
export {
  SmallModelGuard,
  getSmallModelGuard,
  resetSmallModelGuard,
} from "./small-model-guard";
