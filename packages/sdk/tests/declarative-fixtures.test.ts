import { describe, expect, it } from "vitest";

import {
  buildDeclarativePack,
  defineReadTool,
  locator,
  projection,
  scope,
  syntheticDocument,
} from "../src/declarative.js";
import { verifyDeclarativeFixtures } from "../src/declarative-fixtures.js";

describe("declarative synthetic fixtures", () => {
  it("passes immutable document data through the narrow runner boundary", async () => {
    const heading = locator.role("heading");
    const pack = await buildDeclarativePack({
      publisher: "example",
      id: "fixture-pack",
      name: "Fixture pack",
      description: "Fixture runner boundary",
      version: "0.1.0",
      compatibility: {
        runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
        bridgeProtocol: { minimum: 1, maximum: 1 },
      },
      matches: [
        {
          origin: "https://example.test",
          paths: [{ kind: "exact", path: "/" }],
        },
      ],
      metadata: { license: "MIT" },
      tools: [
        defineReadTool({
          name: "example.title",
          description: "Read a title",
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
            required: ["title"],
            properties: { title: { type: "string" } },
          },
          availability: heading,
          scope: scope.single(heading),
          projection: projection.object({ title: projection.text() }),
          fixtures: [
            {
              id: "title",
              document: syntheticDocument({
                url: "https://example.test/",
                root: { tag: "h1", text: "Fixture" },
              }),
              result: { title: "Fixture" },
            },
          ],
        }),
      ],
    });
    const evidence = await verifyDeclarativeFixtures(pack, {
      run(request) {
        expect(Object.isFrozen(request)).toBe(true);
        expect(request.operation.tool).toBe("example.title");
        expect(request.kind).toBe("read");
        expect(request.kind === "read" ? request.document.url : undefined).toBe(
          "https://example.test/",
        );
        return { title: "Fixture" };
      },
    });
    expect(evidence).toEqual({
      passed: true,
      fixtures: [{ id: "title", tool: "example.title", status: "passed" }],
    });
    expect(Object.isFrozen(evidence)).toBe(true);
  });

  it("reports mismatches without copying page data into error codes", async () => {
    const heading = locator.role("heading");
    const pack = await buildDeclarativePack({
      publisher: "example",
      id: "fixture-pack",
      name: "Fixture pack",
      description: "Fixture runner boundary",
      version: "0.1.0",
      compatibility: {
        runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
        bridgeProtocol: { minimum: 1, maximum: 1 },
      },
      matches: [
        {
          origin: "https://example.test",
          paths: [{ kind: "exact", path: "/" }],
        },
      ],
      metadata: { license: "MIT" },
      tools: [
        defineReadTool({
          name: "example.title",
          description: "Read",
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
            required: ["title"],
            properties: { title: { type: "string" } },
          },
          availability: heading,
          scope: scope.single(heading),
          projection: projection.object({ title: projection.text() }),
          fixtures: [
            {
              id: "title",
              document: syntheticDocument({
                url: "https://example.test/",
                root: { tag: "h1" },
              }),
              result: { title: "expected" },
            },
          ],
        }),
      ],
    });
    await expect(
      verifyDeclarativeFixtures(pack, {
        run: () => ({ title: "private-page-value" }),
      }),
    ).resolves.toMatchObject({
      passed: false,
      fixtures: [{ status: "failed", code: "RESULT_MISMATCH" }],
    });
  });
});
