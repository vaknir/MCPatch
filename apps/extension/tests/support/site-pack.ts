import { demoPack } from "@mcpatch/example-packs";
import { definePack, defineTool } from "@mcpatch/sdk/runtime";

import { createReviewedPackCatalog } from "../../src/reviewed-pack-catalog.js";

export const SITE_ORIGIN = "https://example.com";
export const SITE_TOOL = "mcpatch.site.status";
export const NETWORK_ORIGIN = "https://search.example.com";

export const sitePack = definePack({
  ...demoPack.manifest,
  id: "site-demo",
  name: "Site demo",
  description: "A reviewed site pack for extension enablement tests.",
  matches: [
    {
      origin: SITE_ORIGIN,
      paths: [{ kind: "prefix", path: "/app/" }],
    },
  ],
  tools: [
    defineTool({
      name: SITE_TOOL,
      description: "Read deterministic site status.",
      risk: "read",
      permissions: ["READ"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        maxProperties: 0,
        properties: {},
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["status"],
        properties: { status: { const: "ready", type: "string" } },
      },
      execute() {
        return { status: "ready" as const };
      },
    }),
  ],
  fixtures: [
    {
      id: "ready",
      tool: SITE_TOOL,
      input: {},
      expect: { kind: "result", result: { status: "ready" } },
    },
  ],
});

export const networkSitePack = definePack({
  ...sitePack.manifest,
  id: "network-demo",
  name: "Network demo",
  digest: `sha256:${"b".repeat(64)}`,
  networkPolicy: {
    extensionRequests: { origins: [NETWORK_ORIGIN], methods: ["GET"] },
  },
  tools: [
    defineTool({
      name: "mcpatch.network.search",
      description: "Search through one reviewed external origin.",
      risk: "read",
      permissions: ["READ", "EXTERNAL_NETWORK"],
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      outputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {},
      },
      execute() {
        return {};
      },
    }),
  ],
  fixtures: [
    {
      id: "network-result",
      tool: "mcpatch.network.search",
      input: {},
      expect: { kind: "result", result: {} },
    },
  ],
});

export function testCatalog(
  declaredOrigins: readonly string[] = [SITE_ORIGIN],
) {
  return createReviewedPackCatalog(
    [demoPack, sitePack],
    runtimeOptions(),
    declaredOrigins,
  );
}

export function runtimeOptions() {
  return {
    runtimeVersion: "0.1.0",
    bridgeProtocolVersion: 2,
    allowedPermissions: ["READ"] as const,
  };
}
