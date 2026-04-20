import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    preserveSymlinks: true,
  },
  test: {
    globals: true,
    environment: "node",
  },
});
