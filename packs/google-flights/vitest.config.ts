import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mcpatch/sdk/runtime": fileURLToPath(
        new URL("../../packages/sdk/src/runtime.ts", import.meta.url),
      ),
      "@mcpatch/sdk": fileURLToPath(
        new URL("../../packages/sdk/src/index.ts", import.meta.url),
      ),
    },
  },
});
