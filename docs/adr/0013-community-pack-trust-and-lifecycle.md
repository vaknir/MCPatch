# ADR 0013: Separate community pack trust tiers and lifecycle authority

- Status: Accepted
- Date: 2026-09-16
- Issue: [#142](https://github.com/vaknir/MCPatch/issues/142)

## Context

MCPatch needs independently installable community packs without turning a
publisher, registry, or browser page into an authority that can execute code or
grant access to an authenticated origin. Existing ADR 0005 deliberately permits
only fixed-runtime declarative delivery and keeps compiled packs inside reviewed
extension releases. A single marketplace label would obscure the material
difference between MCPatch-maintained artifacts, independently reviewed community
artifacts, and a developer's local unsigned bytes.

Updates and revocation also need a lifecycle that cannot expose a candidate before
it is reviewed, silently expand authority, downgrade to vulnerable bytes, or leave
stale browser contexts alive during cleanup.

## Decision

Define three immutable trust tiers: `OFFICIAL`, `REVIEWED_COMMUNITY`, and
`UNSIGNED_LOCAL_DEVELOPMENT`. Trust is attached to the exact
`publisher/id/version/digest` identity and required on every installed and enabled
record. A publisher key, display name, registry entry, compatibility attestation,
or popularity signal cannot substitute for the tier's required authority.

Official and reviewed-community declarative artifacts require a publisher/bundle
signature plus a separately controlled MCPatch registry attestation. Registry
publication, security revocation, and pack review are separated operational roles;
none can silently grant browser access or replace active bytes. Existing compiled
packs remain official only by shipping in the reviewed extension artifact.

Unsigned local development is permitted only through an explicit, visibly marked
developer surface. It uses a non-colliding local identity, cannot be published by
the registry, cannot replace a signed identity, and requires confirmation whenever
the digest or authority changes.

Candidates are staged separately from active authority. Install, update, enable,
disable, uninstall, permission loss, incompatibility, staleness, and revocation
follow the state machine in
[community pack lifecycle](../architecture/community-pack-lifecycle.md): revoke
contexts and pending calls before cleanup, and never infer active state from
storage, a browser grant, a stale index, or a partial operation.

Changed executable bytes or any change to origins, paths, tools, schemas, risks,
permissions, compatibility, or declarative operations requires explicit review.
The last verified artifact may be offered for rollback only if it is still
compatible, fresh, and not revoked. SemVer ordering never authorizes a downgrade or
cross-publisher replacement.

Every browser-origin permission record stores the complete pack identity and exact
origin/path. Chromium's origin-wide grant is treated as a prerequisite, not as
pack authority. This preserves attribution when several packs share an origin and
ensures uninstall removes MCPatch authority before attempting browser cleanup.

Revocation and cleanup are ordered: (1) mark the pack unavailable and block new
publication/dispatch; (2) close affected contexts and cancel page/bridge calls,
extension work, and pending approvals; (3) publish the old context tombstone and
allow any replacement only at a fresh higher revision; then (4) update storage,
unregister scripts, and remove no-longer-needed permissions. Unregistering a
content script is cleanup, not revocation, because an already injected script can
remain in a live document until its context is closed.

## Consequences

- Users can distinguish maintainer trust, independent review, and local unsigned
  development before granting an origin.
- Registry compromise cannot activate an artifact, replace active bytes, or make a
  local import look reviewed; it can at most deny discovery until repaired.
- Emergency revocation is effective locally as soon as a verified record is
  received, but offline users remain exposed until the bounded freshness deadline;
  stale state then fails closed.
- Update UX is more deliberate because even a compatible tool/schema change may
  alter the authority the user is accepting.
- Shared origin grants require reference tracking and reconciliation, rather than
  a simple origin-to-enabled boolean.
- Firefox and other browsers must implement the same identity and lifecycle rules;
  browser permission APIs are adapters, not trust decisions.

## Alternatives considered

### One marketplace trust label

Rejected. It conflates publisher identity, maintainer review, and local testing and
would encourage users to treat metadata or popularity as authorization.

### Let a valid publisher signature activate a pack

Rejected. A signature authenticates bytes and a key, not MCPatch's operation review,
compatibility, revocation, or browser-origin policy. The registry attestation and
local verification remain separate.

### Replace active bytes in place when the registry publishes an update

Rejected. It hides authority changes and creates downgrade, interrupted-update, and
approval races. Candidates must be reviewed and activated explicitly.

### Treat the browser origin grant as the installed-pack grant

Rejected. Chromium grants at origin granularity and cannot encode which pack the
user reviewed. MCPatch must maintain an attributable identity record and recheck it
before publication and dispatch.

### Permit unsigned local files in the normal catalog

Rejected. A local edit could collide with a signed identity or look like a reviewed
release. Developer mode is a separate, visible trust tier and namespace.

## Related decisions

- [ADR 0005: declarative packs and no runtime-downloaded code](0005-pack-execution.md)
- [ADR 0006: deny-by-default permissions and approvals](0006-permission-and-approval-model.md)
- [ADR 0008: origin-scoped content runtimes](0008-origin-scoped-content-runtime.md)
- [ADR 0014: registry discovery and exact-origin authority](0014-registry-discovery-and-origin-authority.md)
