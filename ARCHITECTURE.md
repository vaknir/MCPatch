# MCPatch architecture

## Purpose

MCPatch presents narrow website capabilities to MCP clients while the browser
retains custody of its authenticated session. The system is useful only if a tool
call is less powerful than direct browser access, so least privilege is an
architectural constraint rather than a user-interface preference.

## Invariants

1. Agents see only explicitly registered, typed tools.
2. Browser credentials and session material never cross into tool arguments,
   results, bridge logs, or the MCP client.
3. A capability is bound to a browser context, allowed origin, pack identity,
   declared permission set, and input schema.
4. All policy decisions are deterministic and default to deny. Model text and page
   text are untrusted data, never policy.
5. Write and sensitive actions require an argument-bound, origin-bound, tool-bound,
   expiring one-time grant unless an equally strict policy explicitly permits them.
6. Installed code is not silently replaced by remote marketplace code.
7. The bridge has no DOM behavior; packs have no direct MCP client access.
8. Community pack trust is attached to an immutable publisher/pack/version/digest
   identity; a browser origin grant is never sufficient pack authority.
9. Registry discovery is an extension-owned control-plane operation triggered by
   explicit user activity, not a tab or browsing-history observer.

## Components

### MCP client

Cursor, Claude Code, or another MCP client starts the local bridge and communicates
using MCP over newline-delimited stdio. The first supported MCP revision is
`2026-07-28`. Support for older revisions is a compatibility feature, not an
assumption in MCPatch's internal protocol.

### Native bridge

The Rust bridge is a local, long-running security boundary. It owns:

- MCP transport and lifecycle handling;
- browser connection abstraction and connection identity;
- context-scoped capability registry;
- schema validation and deterministic routing;
- permission and approval enforcement;
- cancellation and bounded resource use; and
- structured, audit-safe diagnostics written only to stderr.

It does not inspect the DOM, possess website credentials, evaluate pack code, or
provide a general network/filesystem proxy.

The Chromium-facing process is a bounded framing adapter; its caller checks,
wire-format rules, and local IPC seam are documented in
[Native Messaging adapter](docs/architecture/native-messaging-adapter.md).
The implemented Unix rendezvous primitive is documented in
[Local IPC transport](docs/architecture/local-ipc-transport.md).
Core-owned negotiation, liveness, direction checks, and disconnect revocation are
documented in
[Negotiated browser sessions](docs/architecture/browser-sessions.md).

### Browser extension

The Manifest V3 extension is the trusted adapter to the browser. Its service worker
owns the native connection, tab lifecycle, pack activation, capability reporting,
and routing to a matching content script or native WebMCP surface. Content scripts
are injected only for granted origins and receive the minimum message required for
one typed operation.

The extension does not expose cookies, arbitrary JavaScript, unrestricted fetch,
generic page dumps, or generic screenshots. A reviewed tool may return one bounded
typed media result from its own semantic scope; it cannot choose arbitrary browser
surfaces. Host permissions should be optional and requested when the
user enables a pack.

Real-site contexts are owned by top-level isolated-world content ports rather than
global browsing-history observation. A user action grants one declared optional
HTTPS origin, after which the service worker dynamically registers the reviewed
content bundle. Browser-attested sender metadata binds the tab, document, URL, and
origin; disconnect or any authority change revokes the context. The complete
decision is recorded in
[ADR 0008](docs/adr/0008-origin-scoped-content-runtime.md).

### Packs

A pack is a versioned description and implementation of site-specific tools. It
declares identity, publisher, compatible runtime and protocol versions, origins,
tools, JSON Schemas, risk, permissions, network policy, and fixtures.

Initially, packs are local development artifacts or verified, installed bundles.
Marketplace metadata is never executable. Remote code is not downloaded into an
authenticated page at runtime.

Community declarative packs have separate `OFFICIAL`, `REVIEWED_COMMUNITY`, and
`UNSIGNED_LOCAL_DEVELOPMENT` trust tiers. The tier, publisher identity, exact
version, and content digest are retained in every installed/enabled record. A
candidate is staged and reviewed before it can become active; updates, revocation,
staleness, incompatibility, and uninstall revoke live contexts before cleanup.
The state machine and local-override rules are in
[Community pack lifecycle](docs/architecture/community-pack-lifecycle.md).

The closed, separately versioned contract and its activation boundaries are
documented in [Pack Manifest version 1](docs/architecture/pack-manifest-v1.md).

### Registry

The future registry distributes immutable, signed declarative pack releases and
compatibility evidence from one fixed HTTPS control-plane origin. The extension
fetches bounded signed metadata only through its own registry client; packs,
pages, agents, and MCP calls cannot select or invoke that client. Registry metadata
cannot activate a pack, grant a host permission, or replace active bytes.

Matching uses verified cached metadata against the current page only after an
explicit extension action. MCPatch does not request `tabs`/`webNavigation` or run a
background tab observer. For arbitrary HTTPS community origins, Chromium requires
the platform declaration `https://*/*` in `optional_host_permissions`, but the
runtime requests only the exact selected origin after the user reviews the pack.
That declaration and the packaged declarative interpreter are explicit Chrome Web
Store release gates; see [ADR 0014](docs/adr/0014-registry-discovery-and-origin-authority.md).
Runtime operation can continue offline only for a previously verified, fresh, and
unrevoked cached artifact, with freshness visible to the user.

## Capability resolution

For the active context, the extension resolves capabilities in this order:

1. Native WebMCP tools exposed by the document.
2. One unambiguous candidate from all explicitly enabled, compatible MCPatch
   packs—compiled and declarative—whose origin matches exactly.
3. No capability.

A native WebMCP tool's risk and permissions are declared by the page, so the
bridge never allows one without a human decision: every native call takes an
argument-bound one-time approval, and MCPatch emits no read-only, destructive
or idempotent hint for it, because it has reviewed nothing. See
[ADR 0016](docs/adr/0016-native-webmcp-approval.md).

A later automation fallback would be a separate, high-risk subsystem with explicit
permission and approval semantics. It is not part of protocol version 2.

Native and pack tools cannot share a name at all. Every page-declared tool is
published under the reserved `native` namespace, qualified by the origin that
declared it, so a page can neither shadow a reviewed pack's tool nor hide it by
claiming its name; the two are listed side by side under distinct names. The
bridge rejects a native capability outside that namespace, and a pack
capability inside it, so the separation does not depend on the extension. The
bridge also publishes its own attributed description for a native tool and
drops the page's title, rather than forwarding page-authored metadata to the
agent as trusted text. Canonical URL matching, collision outcomes, and context binding
are detailed in
[Pack matching and capability resolution](docs/architecture/pack-resolution.md).

For community packs, discovery metadata is not capability metadata until the
selected artifact, signature, digest, compatibility, revocation, enabled identity,
exact origin/path, and page handshake all pass local validation. For each exact
tool name, compiled and declarative pack candidates participate in one set: exactly one
candidate publishes, while two or more candidates are hidden as ambiguous. There
is no compiled-over-declarative priority.

The bridge does not guess which tab is active in protocol version 2. If the same
tool name is live in multiple contexts or connections, it is hidden from discovery
and calls fail as ambiguous. Snapshot revision, permission, schema, revocation, and
result-binding rules are detailed in
[Capability registry and routing](docs/architecture/capability-routing.md).

## Call flow

1. The extension observes an eligible browser context and resolves its capabilities.
2. It sends a complete context capability snapshot to the bridge.
3. The bridge validates the message, origin, schemas, permissions, and connection.
4. The bridge derives the MCP tool list from accepted snapshots.
5. An MCP client calls a tool with JSON arguments.
6. The bridge validates arguments and policy before routing the call to the exact
   connection and context that registered the capability.
7. If an approval is required, execution pauses until a deterministic grant matches
   the canonical argument hash, tool, origin, expiry, and unused nonce.
8. The extension invokes the bound native capability or installed pack operation.
9. The result is validated against the tool's closed output schema, size-limited,
   and returned to the MCP client. The closed schema is the allowlist; no
   separate scrubbing step exists, so content the schema does not name never
   leaves the browser.

Navigation, tab closure, pack disablement, disconnect, timeout, or cancellation
invalidates the affected registrations and pending calls.

## Trust boundaries

| Boundary            | Untrusted input                                                                      | Required controls                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| MCP client → bridge | method, tool name, arguments, cancellation                                           | framing limits, protocol validation, schema validation, permission policy                                         |
| Extension → bridge  | identity claims, contexts, schemas, results                                          | native-host allowlist, negotiation, message validation, origin binding, size limits                               |
| Website → extension | DOM, native WebMCP tool metadata (name, title, description, schema), events, content | isolated worlds, origin checks, output validation, no policy from page text                                       |
| Pack → extension    | code, manifest, schemas, network intent                                              | installed immutable bundle, signature/trust policy, manifest validation, least privilege, isolated-realm lockdown |
| Registry → runtime  | metadata, updates, compatibility claims                                              | signatures, transparency, explicit install/enable, no runtime code loading                                        |

### Pack-boundary enforcement status

Several boundaries below are honoured by **review** rather than by a runtime
mechanism for the compiled (bundled) pack tier — every reviewed pack until the
declarative interpreter exists. The table states, per claim, what enforces it
today, so a reviewer never trusts a control that is not there for the tier they
are reviewing. Each enforcement PR flips its row and links its issue; moving a row
from review to mechanism is a trust-boundary change and needs an ADR
(CONTRIBUTING.md, "Before implementation" step 2).

| Claim (compiled pack tier)                                 | Enforced by today                                                                        |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| No cookies or tokens in results                            | review + closed output schema (#176); `document.cookie` blocked by realm lockdown (#187) |
| Network only to declared origins                           | realm lockdown + host permissions (#187)                                                 |
| No network under `networkPolicy.extensionRequests: "none"` | realm lockdown: no reachable network primitive (#187)                                    |
| No navigation from `READ` tools                            | realm lockdown plus an action-gated navigator (#188)                                     |
| Image result within its capture scope                      | review; MIME, dimensions, and byte size by mechanism                                     |
| Origin binding                                             | mechanism                                                                                |
| Path binding                                               | content-script registration from the manifest path rules (#180)                          |
| Private-data reads classified `SENSITIVE`                  | review, per [ADR 0015](docs/adr/0015-sensitive-read-classification.md) (#185)            |
| Immutable installed bytes                                  | Chrome bundle integrity; manifest digest unverified at load (#179)                       |

The **declarative community tier** is not yet shippable. Its stronger invariants —
no dynamic selectors, code, navigation, mutation, cookies, storage, or network
primitive — become mechanism as the interpreter and operations schema land
(#143–#147 under Phase 13, #141). Until then no declarative pack can activate, so
those rows do not yet describe running code.

## Protocol boundaries

There are four independent version domains:

- MCP product version: SemVer, beginning at `0.1.0`.
- MCPatch bridge protocol: integer compatibility version, beginning at `1`.
- Pack manifest format: integer compatibility version, beginning at `1`.
- Internal extension page-channel protocol: integer compatibility version,
  beginning at `1` and never exposed as an MCP tool API.

The bridge protocol uses UTF-8 JSON messages with an explicit message type,
protocol version, request/correlation identifier where applicable, and bounded
payload size. Its schema is language-neutral and shared by Rust and TypeScript.
MCP client protocol details do not leak into pack APIs.

## Repository boundaries

The initial monorepo keeps contracts and fixtures atomic across languages:

```text
crates/bridge/       Rust native bridge
apps/extension/      Chromium MV3 extension
apps/registry/       Future registry service; absent until needed
packages/protocol/   Canonical schemas, fixtures, and TypeScript bindings
packages/sdk/        Pack authoring API
packages/cli/        Development and installation commands
packs/               First-party and example packs
docs/adr/            Accepted architecture decisions
docs/architecture/   Focused design documents
```

Directories are added only when their component begins; empty architecture theater
is avoided.

## Initial delivery slices

1. Architecture, threat model, ADRs, repository policy, and strict CI.
2. Canonical bridge protocol schemas, Rust/TypeScript types, and golden tests.
3. Rust MCP stdio skeleton, fake browser connection, and deterministic registry.
4. MV3 extension with native pairing and one test capability.
5. End-to-end demo against a local fixture page.
6. Pack SDK and only then a read-only real-site proof of concept.

## Explicit non-goals for the foundation

- Generic `execute_js`, cookie, token, page-dump, filesystem, or network tools.
- Runtime download and execution of arbitrary marketplace JavaScript.
- Passive discovery through browsing-history or broad tab surveillance.
- Scraping at scale or bypassing site controls.
- A public registry, billing system, or reputation algorithm.
- A Google Flights adapter before the contracts and security boundary are tested.

## Decision records

Material choices are recorded in `docs/adr/`. This document describes the accepted
system shape; ADRs preserve alternatives and consequences.

## References

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome extension permission declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Community pack lifecycle](docs/architecture/community-pack-lifecycle.md)
- [ADR 0013: community pack trust and lifecycle](docs/adr/0013-community-pack-trust-and-lifecycle.md)
- [ADR 0014: registry discovery and exact-origin authority](docs/adr/0014-registry-discovery-and-origin-authority.md)
