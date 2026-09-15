import { definePack, defineTool } from "@mcpatch/sdk/runtime";

import {
  FIXTURE_ORIGIN,
  FIXTURE_STATE_TOOL,
  FIXTURE_WAIT_TOOL,
} from "./fixture-constants.js";

const emptyInput = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
  properties: {},
} as const;

const stateOutput = {
  type: "object",
  additionalProperties: false,
  required: ["revision", "value"],
  properties: {
    revision: { type: "integer", minimum: 0 },
    value: { type: "string", minLength: 1, maxLength: 128 },
  },
} as const;

const fallbackState = defineTool({
  name: FIXTURE_STATE_TOOL,
  description: "Read bounded state from the current synthetic fixture page.",
  risk: "read",
  permissions: ["READ"],
  inputSchema: emptyInput,
  outputSchema: stateOutput,
  execute() {
    return { revision: 0, value: "fixture-fallback" };
  },
});

const fallbackWait = defineTool({
  name: FIXTURE_WAIT_TOOL,
  description: "Wait until a synthetic fixture call is cancelled.",
  risk: "read",
  permissions: ["READ"],
  inputSchema: emptyInput,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["completed"],
    properties: { completed: { type: "boolean" } },
  },
  execute(context) {
    context.signal.throwIfAborted();
    return { completed: true };
  },
});

export const fixturePack = definePack({
  manifestVersion: 1,
  publisher: "fixture",
  id: "chromium-e2e",
  name: "Chromium fixture pack",
  description: "A test-only authority declaration for synthetic browser pages.",
  version: "0.1.0",
  digest:
    "sha256:335f10d87f5c173184287ace34f1d999f40652c6135db94ec7ed1a9e087790e2",
  compatibility: {
    runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
    bridgeProtocol: { minimum: 1, maximum: 1 },
  },
  execution: { kind: "bundled" },
  matches: [
    {
      origin: FIXTURE_ORIGIN,
      paths: [{ kind: "prefix", path: "/" }],
    },
  ],
  networkPolicy: { extensionRequests: "none" },
  tools: [fallbackState, fallbackWait],
  fixtures: [
    {
      id: "state-fallback",
      tool: FIXTURE_STATE_TOOL,
      input: {},
      expect: {
        kind: "result",
        result: { revision: 0, value: "fixture-fallback" },
      },
    },
    {
      id: "wait-fallback",
      tool: FIXTURE_WAIT_TOOL,
      input: {},
      expect: { kind: "result", result: { completed: true } },
    },
  ],
});
