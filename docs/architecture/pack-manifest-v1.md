# Pack Manifest version 1

Pack Manifest version `1` is independent from MCPatch product SemVer and bridge
protocol version `1`. The canonical structural contract is
[`packages/sdk/schema/v1/pack-manifest.schema.json`](../../packages/sdk/schema/v1/pack-manifest.schema.json),
and `@mcpatch/sdk` adds deterministic semantic validation.

## Identity and compatibility

An immutable release is identified by `publisher`, `id`, `version`, and `digest`.
Version 1 publisher handles are lowercase ASCII tool-namespace tokens, and every
tool name must begin with that publisher followed by a dot. Pack IDs are lowercase
ASCII kebab-case. Versions are strict SemVer. Digests use exactly
`sha256:<64 lowercase hex characters>`.

The manifest validator checks digest shape, not artifact integrity. A future
installer must verify the digest against the canonical complete artifact before it
creates an installed-pack record; registry metadata is not proof of integrity.

Runtime compatibility is a closed-open stable SemVer interval:
`minimum <= current < maximumExclusive`. Bridge protocol compatibility is a closed
integer interval. Open-ended ranges are intentionally absent so old manifests do
not silently opt into future runtime or protocol behavior. Unknown manifest and
declarative operations versions are rejected.

## Execution tiers

`execution.kind` is metadata, not a code-loading instruction:

- `declarative` requires operations version `1` and is eligible for independent
  delivery only after its fixed operation vocabulary exists;
- `bundled` means its handler is compiled into a reviewed extension build and the
  manifest cannot identify an entrypoint.

Both execution objects are closed. URLs, source text, module paths, remote scripts,
and additional fields are invalid. The contract never authorizes `eval`, dynamic
code generation, downloaded JavaScript or WebAssembly, or an ambient browser API.

The manifest is the versioned envelope, not the declarative operation payload. A
future operations contract will use the fixed `operationsVersion` and a fixed file
location inside the digest-covered pack artifact; the manifest deliberately has no
path or URL capable of selecting code. Declarative manifests cannot activate until
that interpreter and operations schema are implemented.

## Origins, paths, and network policy

Each match entry contains one canonical exact HTTPS origin and one or more path
rules. Origins cannot contain credentials, paths, queries, fragments, wildcards,
Unicode spellings, or explicit default ports. The canonical URL origin must equal
the manifest string.

Path rules are either exact paths or prefixes. Version 1 paths are absolute ASCII
URL paths without percent encoding, backslashes, repeated separators, queries,
fragments, control characters, or normalizable dot segments. Prefix paths end in
`/`. Query parameters never broaden activation. The pure matching behavior is a
separate Phase 5 slice.

`networkPolicy.extensionRequests` is required and its only version 1 value is
`none`. It means pack execution cannot initiate extension-originated requests;
normal page behavior is not turned into a network proxy.

## Tools and fixtures

Every tool declares a description, risk, permission set, closed object input JSON
Schema, output JSON Schema, and at least one inline deterministic fixture. The risk
must have its corresponding `READ`, `ACTION`, or `SENSITIVE` permission. Tool and
fixture IDs are unique, fixture tool references must resolve, and all collections,
text, JSON depth, JSON node count, and total content are bounded.

Fixtures are untrusted test data. They are part of the pack artifact and identity,
not runtime authority. The later compatibility harness will compile schemas and
execute fixtures without logging their inputs or results.

## Validation and compatibility policy

JSON Schema rejects structural violations. `validatePackManifest` additionally
enforces cross-field and canonicalization rules that JSON Schema cannot express.
Consumers must run both their duplicate-safe JSON decoding and semantic validation;
schema validation alone is insufficient.

Version 1 rejects unknown fields everywhere. Compatible additions therefore require
a new manifest version. Tightening rejection of data that was already invalid or
unsafe is allowed in a patch release; changing accepted meaning, permission scope,
matching behavior, or compatibility intervals requires a new manifest version and
migration note.
