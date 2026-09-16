import { MCPatch } from "@mcpatch/sdk/runtime";

export const DEMO_CONTEXT_ID = "mcpatch.demo";
export const DEMO_ORIGIN = "https://demo.mcpatch.invalid";
export const DEMO_URL = `${DEMO_ORIGIN}/`;
export const DEMO_TOOL_NAME = "mcpatch.demo.status";

const mcp = new MCPatch({
  manifestVersion: 1,
  publisher: "mcpatch",
  id: "builtin-demo",
  name: "MCPatch demo pack",
  description: "A deterministic bundled pack used for local integration tests.",
  version: "0.1.0",
  // Stable integration identity, not a marketplace signature.
  digest:
    "sha256:879486d0000d36f06d47958b5285dec823c7805112a4bd086962c20e1d54fb78",
  compatibility: {
    runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
    bridgeProtocol: { minimum: 2, maximum: 2 },
  },
  execution: { kind: "bundled" },
  matches: [
    {
      origin: DEMO_ORIGIN,
      paths: [{ kind: "exact", path: "/" }],
    },
  ],
  networkPolicy: { extensionRequests: "none" },
});

mcp.tool(
  {
    name: DEMO_TOOL_NAME,
    title: "MCPatch demo status",
    description: "Return deterministic MCPatch demo runtime status.",
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
  },
  (_input, context) => {
    context.signal.throwIfAborted();
    return { status: "ready" as const };
  },
);

export const demoPack = mcp.build({
  fixtures: [
    {
      id: "ready",
      tool: DEMO_TOOL_NAME,
      input: {},
      expect: { kind: "result", result: { status: "ready" } },
    },
  ],
});
