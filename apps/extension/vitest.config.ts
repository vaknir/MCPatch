import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@mcpatch/example-packs": fileURLToPath(
        new URL("../../packs/examples/src/index.ts", import.meta.url),
      ),
      "@mcpatch/protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url),
      ),
      "@mcpatch/sdk/runtime": fileURLToPath(
        new URL("../../packages/sdk/src/runtime.ts", import.meta.url),
      ),
    },
  },
});
