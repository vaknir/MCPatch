import {
  PackToolExecutionError,
  definePack,
  defineTool,
} from "@mcpatch/sdk/runtime";

import {
  FIXTURE_ORIGIN,
  FIXTURE_PROBE_TOOL,
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
    throw new PackToolExecutionError("TOOL_NOT_FOUND");
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
  execute() {
    throw new PackToolExecutionError("TOOL_NOT_FOUND");
  },
});

const fallbackProbe = defineTool({
  name: FIXTURE_PROBE_TOOL,
  description:
    "Report whether the isolated realm lockdown blocks each network primitive.",
  risk: "read",
  permissions: ["READ"],
  inputSchema: emptyInput,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: [
      "fetchUndeclaredBlocked",
      "fetchHttpBlocked",
      "xhrBlocked",
      "sendBeaconBlocked",
      "cookieBlocked",
    ],
    properties: {
      fetchUndeclaredBlocked: { type: "boolean" },
      fetchHttpBlocked: { type: "boolean" },
      xhrBlocked: { type: "boolean" },
      sendBeaconBlocked: { type: "boolean" },
      cookieBlocked: { type: "boolean" },
    },
  },
  execute() {
    throw new PackToolExecutionError("TOOL_NOT_FOUND");
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
    "sha256:92aff532b5c12b6a7648251cd7ca3a57cc149d4a2470a726e808b8f2f2e1c3f4",
  compatibility: {
    runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
    bridgeProtocol: { minimum: 2, maximum: 2 },
  },
  execution: { kind: "bundled" },
  matches: [
    {
      origin: FIXTURE_ORIGIN,
      paths: [{ kind: "prefix", path: "/" }],
      // The synthetic fixture serves its pages from the whole host, so it
      // declares that deliberately rather than relying on a bare "/" prefix.
      wholeOrigin: true,
    },
  ],
  networkPolicy: { extensionRequests: "none" },
  tools: [fallbackState, fallbackWait, fallbackProbe],
  fixtures: [
    {
      id: "state-fallback",
      tool: FIXTURE_STATE_TOOL,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "wait-fallback",
      tool: FIXTURE_WAIT_TOOL,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "probe-fallback",
      tool: FIXTURE_PROBE_TOOL,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
  ],
});
