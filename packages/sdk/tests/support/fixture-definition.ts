import {
  definePack,
  defineTool,
  type JsonObject,
  type JsonValue,
  type PackFixtureExpectation,
  type PackPermission,
  type PackToolHandler,
} from "../../src/index.js";

const DEFAULT_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    value: { type: "string" },
  },
  required: ["value"],
} as const;

const DEFAULT_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    echoed: { type: "string" },
  },
  required: ["echoed"],
} as const;

interface FixtureDefinitionOptions {
  readonly expectation?: PackFixtureExpectation;
  readonly handler?: PackToolHandler;
  readonly input?: JsonObject;
  readonly inputSchema?: JsonObject;
  readonly outputSchema?: JsonObject;
  readonly permissions?: readonly PackPermission[];
  readonly runtime?: {
    readonly minimum: string;
    readonly maximumExclusive: string;
  };
  readonly bridgeProtocol?: {
    readonly minimum: number;
    readonly maximum: number;
  };
}

export function fixtureDefinition(options: FixtureDefinitionOptions = {}) {
  const tool = defineTool({
    name: "mcpatch.fixture.echo",
    description: "Echo a deterministic fixture value",
    risk: "read",
    permissions: options.permissions ?? ["READ"],
    inputSchema: options.inputSchema ?? DEFAULT_INPUT_SCHEMA,
    outputSchema: options.outputSchema ?? DEFAULT_OUTPUT_SCHEMA,
    execute:
      options.handler ??
      ((_context, input) => ({ echoed: input.value as JsonValue })),
  });

  return definePack({
    manifestVersion: 1,
    publisher: "mcpatch",
    id: "fixture-pack",
    name: "Fixture pack",
    description: "Deterministic harness test pack",
    version: "0.1.0",
    digest: `sha256:${"f".repeat(64)}`,
    compatibility: {
      runtime: options.runtime ?? {
        minimum: "0.1.0",
        maximumExclusive: "0.2.0",
      },
      bridgeProtocol: options.bridgeProtocol ?? { minimum: 1, maximum: 1 },
    },
    execution: { kind: "bundled" },
    matches: [
      {
        origin: "https://example.com",
        paths: [{ kind: "prefix", path: "/fixtures/" }],
      },
    ],
    networkPolicy: { extensionRequests: "none" },
    tools: [tool],
    fixtures: [
      {
        id: "echo",
        tool: "mcpatch.fixture.echo",
        input: options.input ?? { value: "safe" },
        expect: options.expectation ?? {
          kind: "result",
          result: { echoed: "safe" },
        },
      },
    ],
  });
}

export const verificationOptions = Object.freeze({
  runtimeVersion: "0.1.0",
  bridgeProtocolVersion: 1,
  allowedPermissions: ["READ"] as const,
});
