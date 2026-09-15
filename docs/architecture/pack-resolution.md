# Pack matching and capability resolution

MCPatch resolves capabilities as a pure operation before the extension publishes a
context snapshot. The resolver has no Chrome API, DOM, network, storage, or handler
execution access. Its opaque candidate values let the extension retain a route while
the resolver considers only validated identity and matching metadata.

## Canonical page location

The resolver separates a page URL into a canonical HTTPS origin and pathname using
the platform URL parser. Host case, Internationalized Domain Names, and default port
spelling normalize into the exact ASCII origin used by Pack Manifest v1. Credentials,
opaque or non-HTTPS URLs, wildcard hosts, fragments, literal whitespace or control
characters, backslashes, malformed percent escapes, and encoded paths fail closed.

Version 1 does not match encoded paths. This avoids differences between URL parsing,
site routing, and application-level decoding. Query parameters are excluded from
path matching and cannot broaden activation; syntactically valid encoded query values
are allowed because they do not participate in matching.

A pack matches when any manifest entry has the exact canonical origin and one path
rule matches. Exact rules require pathname equality. Prefix rules use the validated
prefix, which always ends in `/`, so `/items/` cannot match `/items` or `/itemset/`.

## Deterministic precedence

Candidates are grouped by validated tool name. Names and pack identities use fixed
code-unit ordering; input arrival order is never a tie-breaker.

| Native candidates | Matching pack candidates | Outcome | Diagnostic        |
| ----------------- | ------------------------ | ------- | ----------------- |
| 0                 | 1                        | pack    | none              |
| 0                 | more than 1              | hidden  | ambiguous pack    |
| 1                 | 0                        | native  | none              |
| 1                 | 1 or more                | native  | native precedence |
| more than 1       | any                      | hidden  | ambiguous native  |

Collision diagnostics contain only the tool name, counts, immutable pack identities,
and the deterministic outcome. They are local product diagnostics, not permission to
fall back to a lower-precedence implementation.

## Context binding and lifecycle

Every selected capability references one frozen binding containing the context ID,
positive monotonic context revision, and canonical exact origin. The caller must
create a new revision after navigation and revoke the previous snapshot before using
the new resolution. A pack that no longer matches simply contributes no capabilities.

Pack manifests are semantically revalidated and copied into immutable snapshots
during resolution. Native and pack candidate values remain opaque caller-owned route
tokens and are never serialized by this layer. Runtime dispatch must still verify the
same context, revision, origin, tool, and schema at call time.

The initial resolver bounds native candidates to 256, enabled packs to 64, total
matching candidates to 1,024, and selected capabilities to the protocol limit of 256.
Malformed or oversized input returns a stable field and code without including the
rejected URL, capability, manifest, or opaque value.
