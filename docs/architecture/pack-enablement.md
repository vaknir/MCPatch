# Pack enablement reconciliation

Pack enablement is the only path from a locally verified bundled or installed
declarative pack to browser host authority. It is not controlled by bridge
messages, website content, pack arguments, registry pages, or stored origin
strings. Community trust tiers, candidate state, and revocation are defined in
[Community pack lifecycle](community-pack-lifecycle.md); this document describes
the existing bundled catalog and the shared reconciliation boundary.

## Closed inputs

At build time, the extension validates every compiled pack again and derives a
catalog of pack identity, exact HTTPS page origin, path rules, tool names, and
declared network origins. Every page or network origin must also occur in the
closed `DECLARED_OPTIONAL_ORIGINS` list
mirrored by `optional_host_permissions`. Synthetic `.invalid` packs are excluded.
Wildcards, undeclared origins, duplicate identities, incompatible packs, and
overlong registration identities reject the catalog before the service worker
starts.

The dynamic catalog applies the same origin and path checks to every locally
validated declarative bundle. It uses Chromium's broad optional declaration only
to make an exact selected-origin request expressible; the declaration itself is
never requested or treated as pack authority. See
[ADR 0014](../adr/0014-registry-discovery-and-origin-authority.md).

Signed community bundles enter the same catalog only after the fixed-origin client
has independently verified the fresh index, registry attestation, publisher
signature, content digest, compatibility, and exact summary. Their install record
retains that full identity and can contribute only the packaged declarative
interpreter plus its signed tool allowlist. See
[Community registry v1](community-registry-v1.md).

The toolbar action uses the browser-provided clicked tab and `activeTab` grant. It
enables only when exactly one catalog pack matches that URL. The permission request
is issued in the synchronous user-gesture turn and atomically contains that site's
derived `https://host[:port]/*` pattern plus every reviewed external network
pattern declared by the pack. A denied request writes nothing and registers
nothing. Ambiguous and unsupported pages cannot request authority. Network patterns
are permission proof only and never become content-script registrations.

## Durable request, live proof

`chrome.storage.local["mcpatch.enablement.v1"]` stores at most 32 closed records:

```json
{
  "stateVersion": 1,
  "enabled": [
    {
      "publisher": "example",
      "id": "pack-id",
      "version": "0.1.0",
      "digest": "sha256:...",
      "origin": "https://example.com"
    }
  ]
}
```

Storage access is restricted to `TRUSTED_CONTEXTS` before reads. A record is only a
request: the current pack identity, current Chromium permission, and
exact registered script must all agree before it becomes page authority. The
controller reads Chromium's complete permission inventory and requires every
canonical exact pattern to be present; `permissions.contains()` and covering
wildcards are not proof. It rechecks permission after registration to close removal
races. Unknown, stale, malformed, duplicated, accessor-backed, or wildcard records
are removed.

One packaged `content-script.js` registration is shared by all enabled packs on an
origin. Its generated ID is a reversible hex encoding of the validated origin, so
there is no hash collision. Its deterministic match set is the union of the active
identities' validated path rules. Registration is fixed to the top-level frame,
`document_start`, persistent registration, and the `ISOLATED` world. Unexpected,
legacy, or drifted MCPatch registrations are removed and reconstructed; unrelated
extension registrations are untouched. Reviewed and installed declarative sources
cannot create competing scripts on the same origin.

## Reconciliation and revocation

Startup, install/update, relevant storage changes, and permission additions or
removals enqueue serialized controller reconciliation. Their desired registrations
then enter one serialized aggregate catalog. Relevant external events revoke
in-memory authority and live page contexts synchronously before asynchronous API
work. Any aggregate identity or path-set change closes the old origin context before
script mutation. Disable does the same, persists removal, updates the shared script,
then attempts to remove each host permission only after every registered source has
reconciled and no remaining pack needs that exact pattern.

Any API failure clears aggregate in-memory readiness, cancels live origin contexts
through the document owner, and attempts to remove all managed registrations. A
page remains unavailable until validated pack state, exact permission inventory,
packaged script registration, page handshake, and bridge negotiation all succeed.
It never treats badge state, storage, or a content message as permission proof.
Rapid clicks are coalesced per pack identity, and concurrent source writes converge
without granting authority twice.
