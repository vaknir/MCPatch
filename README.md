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
MCPatch pack. Browser automation is not part of the initial runtime.

The current architecture and security invariants are documented in
[ARCHITECTURE.md](ARCHITECTURE.md). Work is tracked in the
[project roadmap](https://github.com/vaknir/MCPatch/issues/1).

## Status

The repository has its initial architecture, threat model, protocol contracts,
and build foundation. The Rust bridge provides bounded MCP and Native Messaging
adapters, a transport-independent browser connection boundary, and a deterministic
capability registry. A zero-site-permission MV3 extension scaffold is also present;
private Unix and Windows local transports and bridge-core lifecycles are implemented,
along with bounded connect-first rendezvous and isolated bridge-core process start.
Both public adapters now use their distinct authenticated bridge-core endpoints;
browser negotiation and lifecycle ingestion are live, with one synthetic read-only
demo capability proving extension-to-registry publication, MCP discovery, and exact
validated tool-call completion. User-facing pairing and real-site packs remain
upcoming slices.
Product versioning starts at `0.1.0`; the MCPatch bridge protocol and pack manifest
have independent compatibility versions.

The supported transport proof and the remaining packaged-browser gap are described
in [docs/local-demo.md](docs/local-demo.md).

Pack development now has a separately versioned, closed Pack Manifest v1 contract
with TypeScript types, JSON Schema, bounded semantic validation, and golden cases.
Strict `definePack` and `defineTool` authoring primitives keep serializable metadata
separate from reviewed compiled handlers. Pure exact URL matching and deterministic
native-first capability resolution are also implemented. The fixture runner and
real-site adapters remain Phase 5 work.

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
