# ADR 0002: Implement the native bridge in Rust

- Status: Accepted
- Date: 2026-09-15
- Issue: [#4](https://github.com/vaknir/MCPatch/issues/4)

## Context

The bridge is both a long-running local process and a security boundary. It parses
untrusted messages from MCP clients and the browser extension, enforces policy,
tracks capability lifetimes, and routes concurrent calls. Memory safety, bounded
resource use, predictable deployment, and explicit error handling matter more than
sharing implementation code with the browser extension.

## Decision

Implement the bridge in stable Rust from the first executable version.

Use a small dependency set centered on:

- Tokio for asynchronous lifecycle and cancellation;
- serde and serde_json for wire data;
- tracing for structured diagnostics written to stderr;
- thiserror for typed internal errors; and
- rustls if a future local HTTP transport requires TLS.

Transport, policy, registry, and routing are separate modules behind explicit
interfaces. DOM and site-specific behavior remain in the browser runtime. Unsafe
Rust is denied unless a later ADR documents a narrow, reviewed need.

The repository pins a stable Rust toolchain and treats formatting, Clippy warnings,
tests, and dependency advisories as CI gates.

## Consequences

- The bridge can ship as a small native binary without a JavaScript runtime.
- Rust's type system helps make invalid routing and approval states explicit.
- Cross-language protocol fixtures are required; Rust and TypeScript types cannot
  become independent sources of truth.
- Contributors need a Rust toolchain in addition to Node.js.
- Build and packaging work is needed for each supported desktop platform.

## Alternatives considered

### Node.js or TypeScript bridge

Rejected. Shared language familiarity does not outweigh the deployment footprint
and reduced isolation between browser-side code and the native policy boundary.

### Go bridge

Go would provide a simple static deployment and good concurrency. Rust is selected
for stronger memory and data-race safety guarantees, strict modeling of state, and
fine-grained resource control in the highest-trust component.

### Defer the native implementation

Rejected. A temporary bridge in another language would establish contracts and
failure behavior that later need a risky rewrite at the core boundary.
