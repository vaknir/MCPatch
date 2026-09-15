# Pack enablement reconciliation

Pack enablement is the only path from a reviewed extension-bundled site pack to
browser host authority. It is not controlled by bridge messages, website content,
pack arguments, or stored origin strings.

## Closed inputs

At build time, the extension validates every compiled pack again and derives a
catalog of pack identity, exact HTTPS origin, path rules, tool names, and a
deterministic content-script registration ID. Each real origin must also occur in
the closed `DECLARED_SITE_ORIGINS` list mirrored by `optional_host_permissions`.
Synthetic `.invalid` packs are excluded. Wildcards, undeclared origins, duplicate
identities, incompatible packs, and overlong registration identities reject the
catalog before the service worker starts.

The toolbar action uses the browser-provided clicked tab and `activeTab` grant. It
enables only when exactly one catalog pack matches that URL. The permission request
is issued in the synchronous user-gesture turn and contains only that site's
derived `https://host[:port]/*` pattern. A denied request writes nothing and
registers nothing. Ambiguous and unsupported pages cannot request authority.

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
request: the current compiled catalog identity, current Chromium permission, and
exact registered script must all agree before it becomes page authority. The
controller rechecks permission after registration to close removal races. Unknown,
stale, malformed, duplicated, accessor-backed, or wildcard records are removed.

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
to remove host permission only when no remaining pack needs that origin.

Any API failure clears in-memory authority, cancels live origin contexts through the
document owner, and attempts to remove all managed registrations. It never treats
badge state, storage, or a content message as permission proof. Rapid clicks are
coalesced per pack identity, and writes caused by reconciliation converge without
granting authority twice.
