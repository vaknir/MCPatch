# MCPatch

MCPatch turns websites into safe, typed agent capabilities without granting an
agent unrestricted browser access.

It is designed as a capability broker between MCP clients and a user's existing,
authenticated browser session. A site integration exposes only named tools with
declared schemas, origins, permissions, and risk. Cookies, authentication tokens,
generic JavaScript execution, and arbitrary page or network access are not tools.

> [!WARNING]
> MCPatch is pre-alpha. No release is ready for installation or use with sensitive
> accounts.

## Direction

```text
MCP client
    | MCP over stdio
Rust bridge (policy and routing boundary)
    | versioned MCPatch protocol
Browser extension (trusted browser boundary)
    | explicit, origin-bound capability
Native WebMCP or an enabled local/verified pack
    | current page and browser session
Website
```

Capability resolution prefers a site's native WebMCP tools, then an enabled
MCPatch pack. Generic browser automation is not part of the runtime.

The current architecture and security invariants are documented in
[ARCHITECTURE.md](ARCHITECTURE.md). Work is tracked in the
[project roadmap](https://github.com/vaknir/MCPatch/issues/1).

## Status

The repository has its initial architecture, threat model, protocol contracts,
and build foundation. The Rust bridge provides bounded MCP and Native Messaging
adapters, a transport-independent browser connection boundary, and a deterministic
capability registry. The MV3 extension has no required website permission; its only
required host is the fixed credential-free registry control plane;
private Unix and Windows local transports and bridge-core lifecycles are implemented,
along with bounded connect-first rendezvous and isolated bridge-core process start.
Both public adapters now use their distinct authenticated bridge-core endpoints;
browser negotiation and lifecycle ingestion are live, with one synthetic read-only
demo capability proving extension-to-registry publication, MCP discovery, and exact
validated tool-call completion. Local packages now bind a deterministic public
extension identity to platform-correct user-level Native Messaging registration and
source-commit digests. Deterministic real-Chromium fixtures now prove the complete
page-backed pack-to-MCP path. The first reviewed real-site pack implements bounded
Google Flights reads plus one approved typed search action and is bundled behind
exact optional-origin enablement; the MCP-driven signed-out field smoke that
verifies that adapter is recorded in
[docs/test-reports/2026-09-15-google-flights-field.md](docs/test-reports/2026-09-15-google-flights-field.md).
Product versioning starts at `0.1.0`; the MCPatch bridge protocol and pack manifest
have independent compatibility versions.

Which pack-boundary claims are enforced by mechanism and which by review today is stated per tier in the enforcement-status tables in [THREAT_MODEL.md](THREAT_MODEL.md), [ARCHITECTURE.md](ARCHITECTURE.md), and [docs/architecture/pack-manifest-v1.md](docs/architecture/pack-manifest-v1.md).

The Phase 13 community-pack trust, lifecycle, signed static registry, discovery,
extension-owned installation review, and exact-origin authority are implemented.
The contracts are documented in
[ADR 0013](docs/adr/0013-community-pack-trust-and-lifecycle.md),
[ADR 0014](docs/adr/0014-registry-discovery-and-origin-authority.md), and the
[community pack lifecycle](docs/architecture/community-pack-lifecycle.md), with the
wire and publisher contract in
[community registry v1](docs/architecture/community-registry-v1.md), and the
activation policy in
[community pack updates](docs/architecture/community-pack-updates.md). Contributor
submission and maintainer publication are documented in
[community pack contributions](docs/community-pack-contributions.md) and
[registry publishing](docs/registry-publishing.md).

The supported transport proof is described in
[docs/local-demo.md](docs/local-demo.md). Local packaging and registration are
documented in [docs/installation.md](docs/installation.md).
The isolated browser suite is documented in
[docs/testing/chromium-fixtures.md](docs/testing/chromium-fixtures.md).
The first real-site adapter contract is documented in
[docs/architecture/google-flights-adapter.md](docs/architecture/google-flights-adapter.md).
The bundled TradingView adapter exposes the active chart and visible watchlist as
typed reads, returns a bounded active-chart MCP image, resolves company/ticker
queries to canonical symbols, and changes charts through one approved
canonical-symbol action; its contract is documented in
[docs/architecture/tradingview-adapter.md](docs/architecture/tradingview-adapter.md).

Pack development now has a separately versioned, closed Pack Manifest v1 contract
with TypeScript types, JSON Schema, bounded semantic validation, and golden cases.
The FastMCP-style `MCPatch` authoring facade registers schema-inferred typed tools
while strict lower-level primitives keep serializable metadata separate from
reviewed compiled handlers. The browser-free
[declarative authoring API](docs/declarative-pack-authoring.md) produces validated,
deterministic bundle inputs and synthetic fixture suites for bounded reads and
approved typed same-origin navigation. Pure exact URL
matching and deterministic
native-first capability resolution are also implemented. A deterministic fixture
harness now preflights compatibility, permission ceilings, schemas, and fixtures,
then emits payload-free evidence for reviewed compiled packs. One synthetic pack is
now integrated through a codegen-free extension runtime with exact matching,
native-first resolution, typed dispatch, and lifecycle revocation. Real-site
permissions are now explicit, and the isolated content runtime adapts the strict
read-only same-origin subset of native `document.modelContext`. It also runs the
reviewed Google Flights pack through the authorized page channel; service-worker
fallback handlers cannot produce real-site results.

Community authors can use the data-only
[community pack CLI](docs/community-pack-cli.md) to create, validate, test, inspect,
reproducibly build, and prepare an unsigned declarative submission without a browser
or executable pack module.

Those unsigned artifacts can be exercised through the real extension, bridge, and
MCP path with the explicit
[local pack developer mode](docs/local-pack-developer-mode.md). Each import shows
its exact digest and authority, requests only confirmed origins, and remains
visibly `UNSIGNED_LOCAL_DEVELOPMENT`.

The browser SDK now lets a pack register its real per-document handlers and export
one object. It generates page capability routing, discovery, cancellation, safe
errors, subscriptions, tool lists, and fail-closed service-worker plumbing.

The bridge owns argument-bound, expiring, single-use approval state for action and
sensitive tools. The extension presents each decision in its own tab-bound UI and
fails closed if that trusted surface is unavailable. The first real action is the
narrow `flights.search` capability; no generic click, navigation, selector, or script
tool is exposed.

## Bridge development

Run the MCP server over newline-delimited stdio:

```sh
cargo run --bin mcpatch -- mcp-stdio
```

The `mcp-stdio` command is also the default when no command is supplied. Standard
output is reserved exclusively for JSON-RPC frames. Audit-safe structured logs go
to standard error and can be filtered with `MCPATCH_LOG=off|error|warn|info|debug|trace`.
Dependency logging is disabled at the bridge boundary so untrusted request content
is not emitted by upstream libraries.

The bridge currently negotiates MCP `2025-11-25` and `2026-07-28`. It advertises
only live, policy-visible browser capabilities and routes calls through the exact
registered browser context with argument and result-schema validation.

The internal bridge core can be started for development with
`cargo run --bin mcpatch -- bridge-core --channel=development`. It currently owns
the protected local endpoints and lifecycle. Both adapters use the reusable bounded
rendezvous policy. MCP initialization and handlers run in the core rather than in the
replaceable stdio adapter.

## License

This repository is private and no license is granted at this time.
