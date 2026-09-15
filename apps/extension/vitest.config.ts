import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  resolve: {
    alias: {
      "@mcpatch/example-packs": fileURLToPath(
        new URL("../../packs/examples/src/index.ts", import.meta.url),
      ),
      "@mcpatch/google-flights-pack": fileURLToPath(
        new URL("../../packs/google-flights/src/index.ts", import.meta.url),
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
