# `@mcpatch/sdk`

This package owns the separately versioned MCPatch pack contract and authoring API.
Pack Manifest version 1 is available as TypeScript types, deterministic object-level
validation, and JSON Schema.

Browser runtimes should import the codegen-free `@mcpatch/sdk/runtime` entrypoint.
The package root additionally exports the Node.js fixture harness and its Ajv
compiler, and must not be bundled into a Manifest V3 service worker.

```ts
import { parsePackManifest } from "@mcpatch/sdk";

const manifest = parsePackManifest(untrustedDecodedJson);
```

Reviewed extension-bundled packs use the FastMCP-style `MCPatch` builder. Create
one pack, register typed tools, and finalize its immutable runtime definition:

```ts
import { MCPatch } from "@mcpatch/sdk/runtime";

const mcp = new MCPatch({
  manifestVersion: 1,
  publisher: "example",
  id: "search",
  name: "Example search",
  description: "Expose the current search from the reviewed adapter",
  version: "0.1.0",
  digest: `sha256:${"0".repeat(64)}`,
  compatibility: {
    runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
    bridgeProtocol: { minimum: 1, maximum: 1 },
  },
  execution: { kind: "bundled" },
  matches: [
    {
      origin: "https://example.com",
      paths: [{ kind: "prefix", path: "/search/" }],
    },
  ],
  networkPolicy: { extensionRequests: "none" },
});

export const readCurrentSearch = mcp.tool(
  {
    name: "example.current_search",
    description: "Read the current search",
    risk: "read",
    permissions: ["READ"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { includeNearby: { type: "boolean" } },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  async (input, context) => {
    context.signal.throwIfAborted();
    return readReviewedSearchAdapter(context.contextId, input.includeNearby);
  },
);

export const pack = mcp.build({
  fixtures: [
    {
      id: "current-search",
      tool: "example.current_search",
      input: {},
      expect: { kind: "result", result: { query: "fixture" } },
    },
  ],
});
```

The callback returned by `mcp.tool(...)` is the original function, so it remains
directly callable in focused unit tests. Its input and output types are inferred
from the explicit JSON Schemas. TypeScript types disappear at runtime, so MCPatch
does not pretend it can safely derive a validation boundary from annotations alone.

`defineTool` and `definePack` remain available as lower-level immutable primitives
for code generation and advanced composition.

The complete serializable artifact is `pack.manifest`. Executable functions exist
only in the separately frozen `pack.handlers` table, whose names and metadata are
derived from the validated tool definitions. Never publish or sign the complete
runtime definition as a registry artifact.

The execution context deliberately contains only `contextId`, exact `origin`, and
an `AbortSignal`. It has no DOM, cookie, credential, network, JavaScript execution,
or browser-extension API. A bundled handler still runs as reviewed compiled code,
so code review and the extension build boundary remain part of its trust model.

Common JSON Schema `type`, `properties`, `required`, `items`, `enum`, and `const`
shapes infer handler input and output types. That compile-time convenience does not
replace call-time schema validation; the runtime and fixture harness must still
validate every argument and result.

## Fixture verification

Verify a locally compiled definition against an explicit environment and permission
ceiling:

```ts
import { verifyPackFixtures } from "@mcpatch/sdk";

const verification = await verifyPackFixtures(pack, {
  runtimeVersion: "0.1.0",
  bridgeProtocolVersion: 1,
  allowedPermissions: ["READ"],
  timeoutMs: 1_000,
});

if (!verification.ok) {
  throw new Error(`${verification.issue.code} at ${verification.issue.field}`);
}
if (!verification.evidence.passed) {
  throw new Error("pack fixtures failed");
}
```

The harness validates the manifest, exact handler table, compatibility, declared
permissions, all schemas, and all fixtures before it invokes any handler. It then
runs fixtures sequentially and emits immutable, deterministic, payload-free
evidence. Use `PackToolExecutionError` when a fixture intentionally expects a typed
tool error.

Run the focused workspace verification with `pnpm verify:packs`. See
[Pack fixture verification](../../docs/architecture/pack-fixture-verification.md)
for failure semantics and security limits. In particular, the harness does not
sandbox compiled JavaScript and its evidence is never runtime authorization.

## Matching and resolution

`canonicalizePageLocation` and `packMatchesLocation` implement Pack Manifest v1 URL
semantics. `resolveContextCapabilities` accepts native candidates, enabled pack
candidates, and an exact context/revision URL binding. It returns either a stable
payload-free issue or a frozen resolution containing sorted capabilities and explicit
collision diagnostics.

One native capability wins over matching packs with the same name. Multiple native
capabilities or multiple matching packs are ambiguous and therefore hidden; arrival
order never selects a winner. Candidate `value` fields are opaque route tokens and
are not inspected or serialized.

See
[Pack matching and capability resolution](../../docs/architecture/pack-resolution.md)
for canonical URL rules, the complete precedence table, limits, and lifecycle
requirements.

Validation failures contain only a stable code and field path. They never include
the rejected value. Accepted data is returned as a detached deeply frozen snapshot
so later mutation cannot bypass validation. The input must be decoded with a
duplicate-key-rejecting JSON decoder before object-level validation when it came
from an artifact or network boundary; plain `JSON.parse` is not sufficient for
signed pack ingestion.

Pack Manifest v1 has two metadata-only execution tiers:

- `declarative` identifies an artifact for the fixed operations interpreter;
- `bundled` identifies implementation code compiled into a reviewed extension
  release.

Neither tier accepts a URL, source string, entrypoint, script, module, or other
runtime code-loading field. The manifest API does not load or execute code.

See [../../docs/architecture/pack-manifest-v1.md](../../docs/architecture/pack-manifest-v1.md)
for the compatibility, matching, identity, and validation rules.
