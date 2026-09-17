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

The manifest validator checks digest shape, not artifact integrity. For a
Declarative Pack Bundle v1, bundle validation additionally requires
`manifest.digest` to equal the digest of the documented canonical content
projection: the manifest with only its digest member omitted, plus operations
and metadata. This is the common manifest field's bundle-specific projection,
not a second digest contract. Other pack artifact formats may retain their own
complete-artifact digest semantics, and registry metadata is never proof of
integrity.

Runtime compatibility is a closed-open stable SemVer interval:
`minimum <= current < maximumExclusive`. Bridge protocol compatibility is a closed
integer interval. Open-ended ranges are intentionally absent so old manifests do
not silently opt into future runtime or protocol behavior. Unknown manifest and
declarative operations versions are rejected.

## Execution tiers

`execution.kind` is metadata, not a code-loading instruction:

- `declarative` requires a supported operations version (`1` for reads or `2`
  for reads plus typed same-origin navigation) and is eligible for independent
  delivery only through its fixed operation vocabulary;
- `bundled` means its handler is compiled into a reviewed extension build and the
  manifest cannot identify an entrypoint.

Both execution objects are closed. URLs, source text, module paths, remote scripts,
and additional fields are invalid. The contract never authorizes `eval`, dynamic
code generation, downloaded JavaScript or WebAssembly, or an ambient browser API.

The manifest is the versioned envelope, not the declarative operation payload. The
fixed program is embedded in `operations.program` in the one canonical bundle
document; there is no archive path or URL capable of selecting code. See
[Declarative Operations](declarative-operations.md).

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

A match's path rules also decide where the extension registers the pack's
content script: an exact rule registers that path, a prefix rule registers its
subtree. A reviewed bundle therefore runs only on the pages its manifest
declares, rather than running on every page of the host and deciding afterwards
to publish nothing. Chrome grants host permissions per origin whatever pattern
is requested, so `optional_host_permissions` and the enablement prompt stay
origin-granular; the registration is what narrows.

A `prefix` rule of `/` covers the whole host. It is accepted only when the match
also sets `wholeOrigin: true`, and that flag is rejected without such a rule, so
a whole-origin grant is always stated outright.

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

`networkPolicy.extensionRequests` is enforced at runtime by the isolated-world
realm lockdown (`apps/extension/src/realm-lockdown.ts`), installed before any
pack code runs. The lockdown replaces the content-script realm's `fetch` with a
wrapper that requires `https:` and allows only the declared request origins
(same-origin to the page only when the page origin is declared), strips
`Authorization` and `Cookie` headers, and bounds body size; it removes
`XMLHttpRequest`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`, and
makes `document.cookie` throw. So a pack under `extensionRequests: "none"` has no
reachable network primitive, and no pack can reach an undeclared origin or read
cookies, by mechanism rather than review. A lockdown failure publishes no
capability snapshot for the document.

## Pack-boundary enforcement status

Several boundaries below are honoured by **review** rather than by a runtime
mechanism for the compiled (bundled) pack tier — every reviewed pack until the
declarative interpreter exists. The table states, per claim, what enforces it
today, so a reviewer never trusts a control that is not there for the tier they
are reviewing. Each enforcement PR flips its row and links its issue; moving a row
from review to mechanism is a trust-boundary change and needs an ADR
(../../CONTRIBUTING.md, "Before implementation" step 2).

| Claim (compiled pack tier)                                 | Enforced by today                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------- |
| No cookies or tokens in results                            | review + closed output schema (#176)                                            |
| Network only to declared origins                           | host permissions + review; no runtime realm bound yet (#187)                    |
| No network under `networkPolicy.extensionRequests: "none"` | review; no runtime realm bound yet (#187)                                       |
| No navigation from `READ` tools                            | review for ambient unforgeable `Location`; action gate for the SDK route (#188) |
| Image result within its capture scope                      | review; MIME, dimensions, and byte size by mechanism                            |
| Origin binding                                             | mechanism                                                                       |
| Path binding                                               | content-script registration from the manifest path rules (#180)                 |
| Private-data reads classified `SENSITIVE`                  | review, per [ADR 0015](../adr/0015-sensitive-read-classification.md) (#185)     |
| Immutable installed bytes                                  | Chrome bundle integrity; manifest digest unverified at load (#179)              |

The local developer-mode **declarative community tier** accepts only the bounded
read operations schema and never loads pack JavaScript. It therefore has no
route to navigation, mutation, cookies, storage, or network primitives. Registry
distribution and general dynamic enablement remain unshipped (#149–#154 under
Phase 13, #141).

## Tools and fixtures

Every tool declares a description, risk, permission set, closed object input JSON
Schema, closed object output JSON Schema, and at least one inline deterministic
fixture. The risk must have its corresponding `READ`, `ACTION`, or `SENSITIVE`
permission, and reviewers classify each read against
[ADR 0015](../adr/0015-sensitive-read-classification.md). Tool and fixture IDs
are unique, fixture tool references must resolve, and all collections, text, JSON
depth, JSON node count, and total content are bounded.

### Closed schemas

The output schema is the only boundary between page content and the MCP client:
the bridge validates every result against it and there is no separate scrubbing
step. Both schemas are therefore required to be closed, which means every value
they accept is fully described by the pack author:

- the root is `type: "object"` with `additionalProperties` set to `false` or to a
  closed subschema;
- every subschema declares `type`, `const`, or `enum`;
- every nested `type: "object"` subschema is closed the same way;
- every `type: "array"` subschema declares closed `items`; and
- `not` never appears, because a schema that rejects everything ships a tool that
  can never succeed.

Draft 2020-12 applicators such as `allOf` only narrow what a schema accepts and
cannot reopen a closed schema, so validation leaves them to the runtime support
check described below. `validatePackManifest` reports the first violation as
`INVALID_SCHEMA` at the exact subschema path, for example
`tools[0].outputSchema.properties.rows.items`.

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

Manifest syntax does not grant a trust tier. The signed bundle and registry
attestation carry whether an artifact is `OFFICIAL` or `REVIEWED_COMMUNITY`, while
the local installer marks an explicitly imported artifact
`UNSIGNED_LOCAL_DEVELOPMENT`. Consumers must retain that provenance beside the
manifest identity and must not infer it from the publisher string, name, or
registry presence. Community declarative Operations v1 is read-only; Operations
v2 adds only an approved typed same-origin navigation. Both require
`networkPolicy.extensionRequests: "none"`; registry control-plane access is not a
pack permission.
