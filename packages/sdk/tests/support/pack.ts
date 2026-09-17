import { parsePackManifest, type PackManifest } from "../../src/index.js";

export function pack({
  id,
  tools,
  origin = "https://example.com",
  paths = [{ kind: "prefix" as const, path: "/items/" }],
  digestCharacter = "a",
}: {
  id: string;
  tools: readonly string[];
  origin?: string;
  paths?: readonly {
    kind: "exact" | "prefix";
    path: string;
  }[];
  digestCharacter?: string;
}): PackManifest {
  return parsePackManifest({
    manifestVersion: 1,
    publisher: "acme",
    id,
    name: `Pack ${id}`,
    description: `Fixture pack ${id}`,
    version: "0.1.0",
    digest: `sha256:${digestCharacter.repeat(64)}`,
    compatibility: {
      runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
      bridgeProtocol: { minimum: 1, maximum: 1 },
    },
    execution: { kind: "bundled" },
    matches: [{ origin, paths }],
    networkPolicy: { extensionRequests: "none" },
    tools: tools.map((name) => ({
      name,
      description: `Read with ${name}`,
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
        properties: {},
      },
    })),
    fixtures: tools.map((tool, index) => ({
      id: `fixture-${String(index)}`,
      tool,
      input: {},
      expect: { kind: "result", result: {} },
    })),
  });
}

export function identity(manifest: PackManifest) {
  return {
    publisher: manifest.publisher,
    id: manifest.id,
    version: manifest.version,
    digest: manifest.digest,
  };
}
