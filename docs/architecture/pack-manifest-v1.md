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
`/`. Query parameters never broaden activation. Runtime semantics are defined in
[Pack matching and capability resolution](pack-resolution.md).

`networkPolicy.extensionRequests` is required. It is either `none` or a closed,
bounded authority containing one to eight exact HTTPS origins and a canonical
non-empty subset of `GET` and `POST`. `GET` requires a `READ + EXTERNAL_NETWORK`
tool; `POST` requires an `ACTION + EXTERNAL_NETWORK` tool, and the inverse pairings
are also enforced. Other risks and methods remain invalid.

The policy grants no generic request primitive. A reviewed bundled pack must still
compile one fixed operation that constructs its own URL and projects a bounded
typed response. Read operations omit credentials. An authenticated action may use
the browser session only under the stricter reviewed, approved, fixed-request
contract in [ADR 0012](../adr/0012-reviewed-external-session-actions.md). The
extension requests all declared exact host
patterns together with the matched page origin during the user's enable gesture;
missing or removed authority disables the whole pack. See
[ADR 0009](../adr/0009-reviewed-read-network-authority.md).

## Tools and fixtures

Every tool declares a description, risk, permission set, closed object input JSON
Schema, output JSON Schema, and at least one inline deterministic fixture. The risk
must have its corresponding `READ`, `ACTION`, or `SENSITIVE` permission. Tool and
fixture IDs are unique, fixture tool references must resolve, and all collections,
text, JSON depth, JSON node count, and total content are bounded.

Fixtures are untrusted test data. They are part of the pack artifact and identity,
not runtime authority. The
[fixture verification harness](pack-fixture-verification.md) compiles every schema,
preflights every fixture, and executes reviewed local handlers without placing
inputs or results in its deterministic evidence.

The Manifest V3 [compiled-pack runtime](compiled-pack-runtime.md) additionally
requires schemas to fit its smaller codegen-free interpretation subset. A schema
that passes Draft 2020-12 validation but uses an unsupported runtime keyword cannot
be activated by that runtime.

## Validation and compatibility policy

JSON Schema rejects structural violations. `validatePackManifest` additionally
enforces cross-field and canonicalization rules that JSON Schema cannot express.
Consumers must run both their duplicate-safe JSON decoding and semantic validation;
schema validation alone is insufficient.

Version 1 rejects unknown fields everywhere. Compatible additions therefore require
a new manifest version after the first public artifact release. Before that release,
the reviewed read-network shape was added as a recorded pre-release amendment in
ADR 0009; implementations that support only the original `none` value continue to
reject such packs safely. After publication, tightening rejection of data that was
already invalid or unsafe is allowed in a patch release, while changing accepted
meaning, permission scope, matching behavior, or compatibility intervals requires
a new manifest version and migration note.
