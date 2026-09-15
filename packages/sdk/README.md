# `@mcpatch/sdk`

This package owns the separately versioned MCPatch pack contract and, in later
slices, the pack authoring API. Pack Manifest version 1 is available as TypeScript
types, deterministic object-level validation, and JSON Schema.

```ts
import { parsePackManifest } from "@mcpatch/sdk";

const manifest = parsePackManifest(untrustedDecodedJson);
```

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
