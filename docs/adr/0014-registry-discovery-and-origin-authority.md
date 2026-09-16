# ADR 0014: Discover community packs locally and request exact origins

- Status: Accepted
- Date: 2026-09-16
- Issue: [#142](https://github.com/vaknir/MCPatch/issues/142)

## Context

Community packs can target arbitrary HTTPS origins, which cannot all be listed as
static content-script matches. Chromium allows optional host permissions to be
requested at runtime, but its manifest declaration and runtime request have
different scopes. MCPatch must not turn this into background tab surveillance,
silent `<all_urls>` authority, or a registry-controlled network proxy.

The current extension already uses an extension action, `activeTab`, exact
optional-origin requests, dynamic packaged content registration, and no `tabs` or
`webNavigation` permission. Native WebMCP precedence and reviewed compiled packs
must remain unchanged.

## Decision

### Discovery

The registry is a fixed MCPatch control-plane origin. The extension's trusted
service worker may fetch one bounded, signed index and selected immutable bundle
objects from that origin only, with credentials omitted, strict content types,
size/time limits, no user page URL or installed-origin inventory, and no redirects
to another origin. A pack, page, MCP client, or agent cannot choose the registry
URL or invoke registry fetches.

The extension refreshes or consults the index on explicit MCPatch UI activity. A
toolbar/extension action uses the browser-provided clicked tab only during that
gesture; MCPatch canonicalizes its current HTTPS origin and matches it locally
against verified cached metadata. It does not register a global tab observer, read
browsing history, use `tabs`/`webNavigation`, or watch arbitrary pages in the
background. No match or stale cache means no install prompt and no authority.

### Host authority

For arbitrary HTTPS community origins, the Chromium MV3 build declares the
narrowest platform pattern that can express runtime-discovered HTTPS hosts,
`https://*/*`, under `optional_host_permissions`. This declaration is not a grant
and must never be requested as a grant. After the user has selected one verified
pack on one current page and reviewed it, MCPatch calls the permissions API with
only `https://selected-host[:port]/*` for that pack's exact origin (plus any
separately reviewed external origins, which community read-only packs initially
do not have). The request occurs in the same explicit user-gesture flow. The
service worker then proves the exact enabled manifest path itself because the
browser grant is origin-wide.

Before the browser prompt, MCPatch shows: trust tier; publisher signing identity;
pack ID, version, and digest; exact origin and paths; tool names and schemas;
read/action/sensitive risk; permission classes; network policy; compatibility;
verification freshness; and revocation status. The UI states that browser access
is not yet granted and that denial leaves the pack uninstalled/disabled. Only
after this review does the browser-owned prompt appear. A grant is accepted only
if it exactly matches the selected origin; a broader, missing, or removed grant
fails closed.

The packaged content runtime is registered only for that exact granted origin,
top-level frame, and active enabled identity. The runtime receives validated
declarative operations and the authorized tool allowlist, never registry URLs,
raw metadata, a generic selector, a browser object, cookies, storage, or network
authority. Native WebMCP still resolves first, and compiled packs retain their
current behavior.

### Control-plane versus pack authority

Registry access is a product control-plane capability owned by MCPatch. It is not
`EXTERNAL_NETWORK` authority for a pack and cannot be reached through a pack tool.
Community packs are read-only and have `networkPolicy.extensionRequests: "none"`
until a separate ADR authorizes another declarative operation class. Host access to
the selected site enables the packaged interpreter's narrow page adapter; it does
not permit registry calls, arbitrary fetch, cookie APIs, raw DOM, or generic
browser control.

### Portability

Firefox exposes analogous runtime optional host permission APIs and optional host
manifest declarations, but match-pattern, user-prompt, content-registration,
restricted-domain, and MV3 behavior differ. The identity, no-surveillance,
exact-origin, packaged-code, and fail-closed rules are portable requirements.
Firefox support is a follow-up adapter and test matrix; Chrome remains the Phase 13
release prerequisite. No Firefox-only API or behavior is required for the Chrome
product to ship.

## Chrome Web Store release gate

The design is compatible with the security intent of MV3 only if the full
extension functionality remains in the submitted package and remote data is
treated as data interpreted by a deliberately narrow, packaged operation runtime.
MCPatch must not use `eval`, `Function`, dynamic import, remote modules,
WebAssembly, remotely hosted scripts, or a general interpreter for remote
commands. Chrome's MV3 policy specifically warns that a complex command
interpreter fed by remote data can be treated as remote logic, so the bounded
Declarative Operations contract requires an explicit store-policy review rather
than assuming signatures or a data label are sufficient.

The broad `https://*/*` optional declaration is also a release risk under Chrome's
minimum-permission policy, even though runtime requests are exact. Issue #165 must
obtain written review evidence that this declaration is acceptable for the stated
single purpose and user flow. If the Store rejects it, dynamic arbitrary-origin
installation is not release-ready: use a host-limited channel or keep community
packs in local/development builds until the platform offers an equally narrow
declaration. Never silently fall back to a broad runtime grant.

This ADR therefore makes dynamic community installation a release gate, not a
promise that the current extension manifest is already store-approved. The pilot
and final gate issues must include the submitted-policy outcome.

## Consequences

- There is no passive browsing observation or registry call carrying current page
  history; matching happens locally after a user gesture.
- Chrome can show an exact selected-origin request even though the extension must
  declare a broad optional pattern to express arbitrary HTTPS discovery.
- Chromium path scope is broader than the pack path scope, so MCPatch must enforce
  path matching at every lifecycle and call boundary.
- Registry outage prevents new discovery/install/update, while a previously
  verified, fresh, unrevoked artifact may continue with visible freshness state.
- Browser portability is a contained adapter project rather than a prerequisite for
  the Chrome implementation.
- Store policy review may constrain the release channel; the security boundary does
  not weaken to satisfy distribution.

## Alternatives considered

### Observe all tabs with `tabs` and `webNavigation`

Rejected. It adds browsing-history authority and background surveillance that are
not needed when the user explicitly selects the current page.

### Declare every community host statically

Rejected. It cannot scale to arbitrary origins and would require extension updates
for catalog changes.

### Use only `activeTab`

Rejected as the durable model. It is gesture-scoped and does not represent a
persistent enabled pack across navigation or restart. It remains useful for the
selection gesture, not as proof of installed authority.

### Request `https://*/*` at runtime

Rejected. The broad optional declaration is a platform prerequisite, never a
runtime request. Requesting it would violate exact-origin consent.

### Let the registry page request permission or inject code

Rejected. A website or registry UI is not a trusted authority surface. Only the
extension-owned flow may present the verified record and call the browser permission
API.

### Use remote JavaScript or a general remote command interpreter

Rejected by ADR 0005 and MV3 policy. Declarative data is accepted only through a
fixed, non-computational, packaged interpreter with independent validation.

## References

- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome Manifest V3 additional requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- [Chrome Manifest V3 remote-code change](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [Chrome Web Store program policies](https://developer.chrome.com/docs/webstore/program-policies)
- [Firefox optional host permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_host_permissions)
- [Firefox runtime permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/permissions/request)
- [ADR 0008: origin-scoped content runtime](0008-origin-scoped-content-runtime.md)
- [ADR 0013: community pack trust and lifecycle](0013-community-pack-trust-and-lifecycle.md)
