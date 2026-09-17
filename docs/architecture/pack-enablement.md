# Pack enablement reconciliation

Pack enablement is the only path from a locally verified bundled or installed
declarative pack to browser host authority. It is not controlled by bridge
messages, website content, pack arguments, registry pages, or stored origin
strings. Community trust tiers, candidate state, and revocation are defined in
[Community pack lifecycle](community-pack-lifecycle.md); this document describes
the existing bundled catalog and the shared reconciliation boundary.

## Closed inputs

At build time, the extension validates every compiled pack again and derives a
catalog of pack identity, exact HTTPS page origin, path rules, tool names, declared
network origins, and a deterministic content-script registration ID. Every page or
network origin must also occur in the closed `DECLARED_OPTIONAL_ORIGINS` list
mirrored by `optional_host_permissions`. Wildcards, undeclared origins, duplicate
identities, incompatible packs, and overlong registration identities reject the
catalog before the service worker starts.

A pack that declares a synthetic `.invalid` origin is a **configurable-origin**
pack: its real deployment is self-hosted, so the catalog substitutes each origin
the user configured for that pack identity and binds the reviewed manifest and
its path rules to it. Such a pack contributes no site until configuration exists,
and its placeholder origin is never requested, granted, or matched. Configured
origins are not in `DECLARED_OPTIONAL_ORIGINS`; they are expressed through the
broad optional declaration and proved exactly at enablement. The catalog is
rebuilt whenever that configuration changes. See
[ADR 0015](../adr/0015-configurable-pack-origins.md).

The future dynamic catalog applies the same checks to each locally verified
declarative bundle. It may use Chromium's broad optional declaration only to make
an exact selected origin request expressible; it never treats that declaration or
an existing browser grant as pack authority. See
[ADR 0014](../adr/0014-registry-discovery-and-origin-authority.md).

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

`chrome.storage.local["mcpatch.origins.v1"]` separately stores at most 32
closed `{publisher, id, origin}` records naming which self-hosted site a
configurable pack should be offered on. It is likewise only a request.

Storage access is restricted to `TRUSTED_CONTEXTS` before reads. A record is only a
request: the current compiled catalog identity, current Chromium permission, and
exact registered script must all agree before it becomes page authority. The
controller rechecks permission after registration to close removal races. Unknown,
stale, malformed, duplicated, accessor-backed, or wildcard records are removed.

Permission proof reads the complete `permissions.getAll()` origin inventory and
requires each of a site's exact patterns within it. A covering grant —
`<all_urls>`, `*://*/*`, `https://*/*`, or a wildcard subdomain covering the
host — is refused as proof and leaves the pack disabled. `permissions.contains`
is deliberately absent from the extension's Chromium surface, because a broader
granted pattern satisfies an exact-looking query.

One packaged `content-script.js` registration is shared by all enabled packs on an
origin. Its generated ID is a reversible hex encoding of the validated origin, so
there is no hash collision. Registration is fixed to one match pattern, frame zero,
`document_start`, persistent registration, and the `ISOLATED` world. Unexpected or
drifted MCPatch registrations are removed and reconstructed; unrelated extension
registrations are untouched.

## Reconciliation and revocation

Startup, install/update, relevant storage changes, and permission additions or
removals enqueue one serialized reconciliation. Relevant external events revoke
in-memory authority and live page contexts synchronously before asynchronous API
work. Disable does the same, persists removal, unregisters the script, then attempts
to remove each host permission only when no remaining pack needs that exact pattern.

Any API failure clears in-memory authority, cancels live origin contexts through the
document owner, and attempts to remove all managed registrations. It never treats
badge state, storage, or a content message as permission proof. Rapid clicks are
coalesced per pack identity, and writes caused by reconciliation converge without
granting authority twice.
