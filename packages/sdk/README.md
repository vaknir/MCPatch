# `@mcpatch/sdk`

This package owns the separately versioned MCPatch pack contract and authoring API.
Pack Manifest version 1 is available as TypeScript types, deterministic object-level
validation, and JSON Schema.

```ts
import { parsePackManifest } from "@mcpatch/sdk";

const manifest = parsePackManifest(untrustedDecodedJson);
```

Reviewed extension-bundled packs use `defineTool` and `definePack`:

```ts
import { definePack, defineTool } from "@mcpatch/sdk";

const currentSearch = defineTool({
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
    properties: { query: { type: "string" } },
    required: ["query"],
  },
  async execute(context, input) {
    context.signal.throwIfAborted();
    return readReviewedSearchAdapter(context.contextId, input.includeNearby);
  },
});

const pack = definePack({
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
  tools: [currentSearch],
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
