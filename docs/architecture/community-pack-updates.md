# Community pack updates, rollback, and revocation

Community pack releases are immutable artifacts. A registry publication may advertise
up to three signed versions of one `publisher/id` identity so the active release, one
reviewable successor, and one rollback artifact can coexist. Reusing an exact
`publisher/id/version` for different bytes is rejected; SemVer precedence chooses an
update candidate but never activates it.

## Durable authority

Trusted-context-only storage separates an inactive candidate from the installed
record. The active and previous records pin:

- publisher, pack ID, SemVer, and bundle digest;
- enrolled publisher key and MCPatch trust tier;
- Declarative Operations version;
- sorted exact HTTPS origins; and
- the independently verified immutable bundle bytes.

The registry sequence remains a monotonic high-water mark. Every startup and state
change re-verifies the cached signed index, registry attestation, publisher signature,
digest, compatibility, pinned authority fields, freshness, browser grants, and bundle
program before authority can reopen. The version-2 storage key deliberately ignores
and removes the pre-update version-1 development record; an older extension similarly
does not understand or activate version-2 state.

## Update transaction

An explicit toolbar action fetches a newer signed index from the fixed credential-free
origin. The fresh index is adopted first, so a revocation takes effect before update
discovery. A higher SemVer release becomes a five-minute inactive candidate only after
its immutable bytes verify. The extension review labels the operation as an update and
shows both current and candidate identity, digest, origin/path rules, tools, schemas,
risk, permissions, compatibility, keys, trust, and verification evidence.

Confirmation rechecks the candidate and current state, then requires the complete
exact-origin permission set. Runtime definitions and packaged content registration are
reconciled transactionally. Success atomically makes the candidate authoritative and
retains the old artifact as the sole rollback. Any storage, permission, content-script,
validation, or runtime failure restores the previous active state; the failed candidate
never gains authority.

Downgrades are never update candidates. A publisher or key cannot replace a different
publisher identity, and a same-version digest change is identity reuse rather than an
update. Publisher-key, trust, origin/path, tool, schema, risk, permission,
compatibility, operation, or digest changes are all covered by the new immutable bundle
and therefore require the same explicit review.

## Rollback

When no newer release exists, an explicit toolbar action may stage the one retained
previous artifact as a rollback candidate. It is offered only when its exact entry is
still present, active, fresh, compatible, publisher-valid, and registry-attested. A
revoked or incompatible previous release is never offered. Successful rollback clears
the previous slot, preventing an unbounded or silent version carousel.

## Emergency revocation and failure policy

On receipt of a newer valid signed index, a revoked active entry is marked unavailable
before managed-script or permission cleanup. Aggregate origin authority closes live
page contexts, cancels their pending page and bridge calls and approvals, and publishes
the context closure before cleanup. The disabled installed identity remains attributable
in storage but cannot publish tools. A fixed-origin browser fixture verifies install,
reviewed update, MCP invocation, signed revocation, and MCP tool removal end to end.

| Condition                          | Result                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| Network unavailable                | Continue only with a still-fresh previously verified index and artifact.        |
| Invalid online index               | Reject that refresh; never replace or extend cached authority.                  |
| Freshness expiry                   | Close current contexts and disable the record.                                  |
| Active entry disappears            | Disable it; do not infer an update or publisher transfer.                       |
| Active release is revoked          | Close contexts immediately; a separately active higher release may be reviewed. |
| Previous release is revoked        | Keep it non-authoritative and never offer rollback.                             |
| Publisher key changes              | Accept only on a distinct reviewed higher release; never reinterpret old bytes. |
| Runtime/operations incompatibility | Disable the affected artifact.                                                  |
| Extension rollback                 | Older storage/runtime versions cannot interpret or activate newer state.        |
| Interrupted activation             | Restore the prior verified active state or remain fully closed.                 |

Lifecycle audit events contain only a fixed event version, event type, publisher, pack
ID, version, digest, and status. They never contain tool arguments, outputs, page data,
URLs, credentials, cookies, tokens, or bundle contents.
