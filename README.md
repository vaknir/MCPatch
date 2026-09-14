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

The repository is establishing its architecture, threat model, protocol contracts,
and build foundation. Product versioning starts at `0.1.0`; the MCPatch bridge
protocol and pack manifest have independent compatibility versions.

## License

This repository is private and no license is granted at this time.
