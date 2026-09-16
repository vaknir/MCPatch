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

The closed, separately versioned contract and its activation boundaries are
documented in [Pack Manifest version 1](docs/architecture/pack-manifest-v1.md).

### Registry

The future registry distributes immutable, signed pack releases and compatibility
evidence. It is not in the trusted call path and cannot silently activate a pack.
Runtime operation remains possible without the registry.

## Capability resolution

For the active context, the extension resolves capabilities in this order:

1. Native WebMCP tools exposed by the document.
2. Explicitly enabled, compatible MCPatch packs whose origin matches exactly.
3. No capability.

A later automation fallback would be a separate, high-risk subsystem with explicit
permission and approval semantics. It is not part of protocol version 2.

Native and pack tools with the same logical name do not merge. Native capabilities
win, and the collision is recorded without exposing page-controlled metadata as a
trusted description. Canonical URL matching, collision outcomes, and context binding
are detailed in
[Pack matching and capability resolution](docs/architecture/pack-resolution.md).

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
9. The result is validated, size-limited, stripped of forbidden data, and returned
   to the MCP client.

Navigation, tab closure, pack disablement, disconnect, timeout, or cancellation
invalidates the affected registrations and pending calls.

## Trust boundaries

| Boundary            | Untrusted input                              | Required controls                                                                        |
| ------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------- |
| MCP client → bridge | method, tool name, arguments, cancellation   | framing limits, protocol validation, schema validation, permission policy                |
| Extension → bridge  | identity claims, contexts, schemas, results  | native-host allowlist, negotiation, message validation, origin binding, size limits      |
| Website → extension | DOM, native WebMCP metadata, events, content | isolated worlds, origin checks, output validation, no policy from page text              |
| Pack → extension    | code, manifest, schemas, network intent      | installed immutable bundle, signature/trust policy, manifest validation, least privilege |
| Registry → runtime  | metadata, updates, compatibility claims      | signatures, transparency, explicit install/enable, no runtime code loading               |

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
