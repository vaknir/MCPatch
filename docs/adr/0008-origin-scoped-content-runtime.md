# ADR 0008: Use origin-scoped isolated content runtimes with document-owned contexts

- Status: Accepted
- Date: 2026-09-15
- Issue: [#97](https://github.com/vaknir/MCPatch/issues/97)

## Context

The extension must eventually read and invoke narrow capabilities in an authenticated
website. Permanent all-sites access, browsing-history APIs, or a generic page bridge
would turn the extension into the broad browser capability that MCPatch is designed
not to expose. Manifest V3 service workers also have an interruptible lifecycle, so
an in-memory active-tab assumption is not a safe ownership model.

Chromium can grant an extension a specific optional origin after a user gesture and
can dynamically register an isolated-world content script for that origin. A
content script's long-lived runtime port carries browser-attested sender metadata,
including its extension ID, top-level frame ID, tab ID, document ID, URL, and origin.
The port lifecycle therefore supplies a narrower context signal than observing all
browser navigation.

Native WebMCP is also available through `document.modelContext` in supporting
browsers, but the API remains a draft. Its types and behavior must not become the
stable MCPatch bridge contract.

## Decision

The production extension uses the following authority model for real sites:

1. `nativeMessaging`, `storage`, `scripting`, and `activeTab` are the only baseline
   extension permissions needed for this phase. `activeTab` is used only to identify
   the user-selected page during the extension-action gesture; it does not enable a
   pack by itself.
   _Amended 2026-09-16 ([#192](https://github.com/vaknir/MCPatch/issues/192)):_
   `activeTab` was removed. The `action.onClicked` event already delivers the
   selected tab, and `activeTab` together with `scripting` would grant a
   click-to-inject capability nothing in the extension uses. The baseline set is
   now exactly `nativeMessaging`, `storage`, and `scripting`, pinned by
   `apps/extension/tests/manifest.test.ts`.
2. Every supported site is declared under `optional_host_permissions`. The user
   enables one reviewed pack from an extension-controlled gesture, and MCPatch asks
   Chromium for that pack's exact HTTPS origin pattern. A path rule is still checked
   by MCPatch because Chromium host permissions are origin-wide.
3. After a grant, the service worker dynamically registers a deterministic content
   script for the enabled origin. It runs in Chromium's default `ISOLATED` world,
   only in the top-level frame, and only from extension-packaged files. It is removed
   when the pack is disabled or its permission is revoked.
4. MCPatch does not request `tabs` or `webNavigation`. A top-level content script
   opens a fixed-name extension port. The service worker accepts it only when the
   browser-attested sender ID, frame, tab, document, URL, and canonical origin agree
   with an enabled compatible pack and a currently granted host permission.
5. A live accepted port owns exactly one document context. Document replacement,
   port disconnect, origin change, permission removal, pack disablement, definition
   replacement, or bridge disconnect revokes its published snapshot and pending
   calls. A new document receives a fresh monotonic revision; an old `documentId`
   can never regain ownership.
6. Service-worker memory is not durable authority. Enabled-pack records live in a
   small versioned `chrome.storage.local` object whose access is restricted to
   trusted extension contexts. Startup reconciles stored state, actual permissions,
   and registered scripts. Corruption or disagreement disables access.
7. Content communication uses a separately versioned, closed, bounded JSON protocol.
   It carries only capability refreshes, exact typed calls, results, errors,
   cancellation, and lifecycle. It has no selector, script, cookie, storage, fetch,
   page-dump, or generic DOM operation.
8. A reviewed compiled page adapter may call site-specific DOM APIs directly inside
   its isolated content bundle. Only its declared named handlers are remotely
   invocable. No `Document`, DOM node, extension API, or unrestricted callback is
   passed upward to a pack, bridge, or agent.
9. Native WebMCP discovery and execution sit behind a content-side draft adapter.
   It discovers same-origin tools only, keeps the browser's opaque registered-tool
   handles local to that document, validates all projected metadata and results, and
   prefers an eligible native tool over a pack with the same logical name.

The extension action must make enablement and disablement observable through its own
badge and title. A denied permission leaves the pack disabled. Removal of a no-longer
needed permission is attempted on disable; failure still revokes MCPatch state and
script registration locally.

## Security invariants

- Page scripts cannot open an authenticated extension port directly or choose its
  browser-attested sender metadata.
- Only top-level, non-opaque, canonical HTTPS documents can own contexts in version
  1. Cross-origin and same-origin subframes are excluded.
- Stored state is an enablement request, not proof of permission. Chromium's current
  permission state is checked whenever authority is reconstructed.
- A content port cannot register arbitrary tools. Its reported capabilities must
  match an enabled reviewed manifest or the bounded native WebMCP projection.
- Tool calls remain bound to the exact bridge connection, context ID, revision,
  origin, tool, schema, and permission policy at every hop.
- Website data and native WebMCP annotations remain untrusted content and cannot
  grant permissions or approve actions.

## Consequences

- Users grant access per supported origin and can remove it through either MCPatch or
  Chromium.
- MCPatch avoids browsing-history permissions and does not need a global tab
  observer to detect navigation.
- A service-worker restart temporarily removes capabilities until live documents
  establish fresh ports; stale snapshots are never reconstructed from storage.
- Compiled site adapters remain part of reviewed extension releases. Independent
  marketplace delivery still requires the declarative runtime from ADR 0005.
- Chromium grants host access at origin granularity, so MCPatch must enforce pack
  path matches itself and clearly communicate that browser-level scope.
- Native WebMCP compatibility can evolve without changing the stable bridge
  protocol, at the cost of a maintained draft adapter and browser-version tests.

## Alternatives considered

### Observe every navigation with `tabs` and `webNavigation`

Rejected for the initial runtime. It introduces browsing-history authority and a
broader lifecycle feed than a user-enabled origin needs. Content-port ownership is
both narrower and naturally tied to one document.

### Use only `activeTab` and inject on every toolbar click

Rejected as the durable enablement model. The temporary grant disappears on
navigation and cannot safely reconstruct enabled packs after restart. `activeTab`
is retained only to identify the page selected by the user gesture.

### Declare static content scripts for every supported site

Rejected. Dynamic registration makes installed code track explicit local enablement
and permits deterministic removal and reconciliation.

### Inject a main-world shim and communicate through `window.postMessage`

Rejected for packs. Page scripts can spoof or observe that channel, and main-world
execution shares page JavaScript state. Native WebMCP is accessed through the
browser-provided API in the isolated extension world when available.

### Expose a generic DOM or JavaScript RPC to the service worker

Rejected. An allowlist of selectors is still a page-query language that tends toward
ambient read access. Reviewed handlers expose only task-specific typed results.

## References

- [Chrome optional permissions](https://developer.chrome.com/docs/extensions/reference/api/permissions)
- [Chrome scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting)
- [Chrome runtime sender metadata](https://developer.chrome.com/docs/extensions/reference/api/runtime)
- [Chrome storage API](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [WebMCP community draft](https://webmachinelearning.github.io/webmcp/)
