import type { DeclarativePackBundleContent } from "@mcpatch/sdk/runtime";

import { FIXTURE_LOCAL_TOOL, FIXTURE_ORIGIN } from "./fixture-constants.js";

/** Checked-in unsigned data fixture; production import still validates its bytes. */
export const fixtureLocalBundle = Object.freeze({
  bundleVersion: 1,
  manifest: {
    manifestVersion: 1,
    publisher: "example",
    id: "read-page",
    name: "Chromium local declarative fixture",
    description:
      "Test-only unsigned declarative pack for the real browser and MCP path.",
    version: "0.1.0",
    digest:
      "sha256:7e7cbd3ffd8a6b5f0811b2d151b21235564b875dc5c30937b148cc852a04bb7f",
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: { minimum: 2, maximum: 2 },
    },
    execution: { kind: "declarative", operationsVersion: 1 },
    matches: [
      {
        origin: FIXTURE_ORIGIN,
        paths: [{ kind: "prefix", path: "/" }],
        wholeOrigin: true,
      },
    ],
    networkPolicy: { extensionRequests: "none" },
    tools: [
      {
        name: FIXTURE_LOCAL_TOOL,
        description: "Return visible text from the current synthetic page.",
        risk: "read",
        permissions: ["READ"],
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
        outputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["text"],
          properties: { text: { type: "string" } },
        },
      },
    ],
    fixtures: [
      {
        id: "current-item",
        tool: FIXTURE_LOCAL_TOOL,
        input: {},
        expect: { kind: "result", result: { text: "fixture-item" } },
      },
    ],
  },
  operations: {
    operationsVersion: 1,
    program: {
      version: 1,
      operations: [
        {
          kind: "read",
          tool: FIXTURE_LOCAL_TOOL,
          availability: {
            kind: "present",
            locator: { kind: "role", role: "main" },
          },
          scope: {
            kind: "single",
            locator: { kind: "role", role: "main" },
          },
          projection: {
            kind: "object",
            fields: [{ key: "text", value: { kind: "text" } }],
          },
        },
      ],
    },
  },
  metadata: {
    license: "MIT",
    homepage: "https://example.test/declarative-read",
    sourceCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
} as const satisfies DeclarativePackBundleContent);
