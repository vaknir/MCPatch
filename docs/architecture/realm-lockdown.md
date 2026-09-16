# Isolated-realm lockdown for compiled packs

A reviewed compiled (bundled) pack runs inside the extension's isolated-world
content script. That realm has the full network authority of a content script:
its own `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, and
`navigator.sendBeacon`, plus a `Document.prototype` whose `cookie` accessor reads
the page's non-HttpOnly cookies. Before this lockdown,
`networkPolicy.extensionRequests` was honoured only by review of pack source and
by Chrome host permissions; nothing MCPatch-owned bounded those primitives at
runtime, so THREAT_MODEL.md invariant 2 read as mechanism where it was review.

## Mechanism

`apps/extension/src/realm-lockdown.ts` exports `lockRealm(realm, policy)`. The
content script (`apps/extension/src/content-script.ts`) calls it against the
isolated-world `globalThis` **before any pack code runs** — before the reviewed
document adapter constructs or executes a pack handler — with the network policy
computed by `reviewedRealmNetworkPolicy` from the declared request origins of the
reviewed packs whose match rules select the current page.

The lockdown installs a fixed, frozen, non-configurable set of replacements:

- **`fetch`** is replaced with a wrapper that requires `https:`, allows only the
  declared request origins (exact, normalised; same-origin to the page is allowed
  only when the page origin is itself declared), strips any `Authorization` or
  `Cookie` header set by pack code, and rejects an over-large request body or a
  response whose declared length is over the cap. The credentials the caller
  requests are preserved, so the reviewed, approved session actions
  ([ADR 0012](../adr/0012-reviewed-external-session-actions.md)) still send the
  browser session to their declared origins; because an undeclared origin is
  refused outright, no credentialed request can reach one, and a
  credential-free read ([ADR 0009](../adr/0009-reviewed-read-network-authority.md))
  stays credential-free by the pack passing `credentials: "omit"`.
- **`XMLHttpRequest`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`** are
  removed, so the wrapped `fetch` is the only network channel left.
- **`Document.prototype.cookie`** becomes a throwing accessor, so pack code can
  neither read nor write cookies.
- **Navigation** loses every ambient primitive: `location.assign`,
  `location.replace`, assignment to `location.href`, `window.open`, and
  `HTMLFormElement.prototype.submit` / `requestSubmit` all throw. `href` keeps
  its getter, because reading the current URL is an ordinary DOM read. The
  captured entry point is returned to the caller rather than left reachable.

Every replacement is non-configurable and frozen, so pack code cannot `delete`,
redefine, or walk a prototype back to the original. The isolated world has its
own globals and prototypes, so none of this is observable from the page's own
realm.

## Fail-closed

`lockRealm` is all-or-nothing: if any step throws — including a malformed
declared origin — it rethrows, and the content script publishes no capability
snapshot for the document. A document with a partially locked realm therefore
exposes no MCPatch capabilities.

## Navigation

Navigation is a side effect with no permission class of its own, so before this
any handler, including one declared `risk: "read"`, could move the page. On an
authenticated origin that is state-changing: it can trigger a server action
through a GET, sign the user out, or move the user to a page the pack then
reads.

With the ambient primitives gone, the only route left is the entry point
`lockRealm` returns. The reviewed document adapter wraps it in a
`PackNavigationGate` per pack and hands the pack a plain `navigate(url)`. The
gate refuses unless an approved `ACTION` tool from that pack is running, and
refuses a target the pack's manifest does not match, so an approved action
cannot be turned into a trip to an arbitrary page. It authorizes at most one
navigation per call.

Authorization happens while the action is running, but the navigation itself is
deferred to the next task, because it unloads the document and would otherwise
destroy the page runtime before the tool result reached the client.

In the SDK, `BrowserToolContext` gains `navigate` only for a tool declared
`risk: "action"`, so a read handler cannot reach for it in typed code and is
refused at runtime as well.

## Scope

The lockdown bounds the compiled-pack tier. It does not change bridge policy: a
`[READ, EXTERNAL_NETWORK]` pack tool is still `Allow` without a per-call approval
(the credential-free read case of
[ADR 0015](../adr/0015-sensitive-read-classification.md)); the lockdown is the
mechanism that makes that safe, not a new restriction on it. Navigation side
effects from pack code are a separate concern tracked in #188.

## Tests

- `apps/extension/tests/realm-lockdown.test.ts` unit-tests every branch: declared
  vs. undeclared origin, `https` enforcement, same-origin-to-undeclared-page,
  credential preservation, header stripping, body and response bounds, removal of
  each other primitive, the throwing cookie accessor, non-configurability under
  `delete`/`defineProperty`, and fail-closed on a missing or malformed input.
- The Chromium fixture (`apps/extension/e2e/`) locks the fixture realm and calls a
  `fixture.realm_probe` pack tool that reports whether each primitive is blocked
  from inside a real page's isolated world, while the credential-free DOM read
  still works. See [chromium-fixtures.md](../testing/chromium-fixtures.md).
