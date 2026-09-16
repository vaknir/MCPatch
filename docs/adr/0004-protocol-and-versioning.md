# ADR 0004: Use a strict, versioned JSON bridge protocol

- Status: Accepted
- Date: 2026-09-15
- Issue: [#6](https://github.com/vaknir/MCPatch/issues/6)

## Context

The Rust bridge and TypeScript extension need a language-neutral contract for
connection lifecycle, capability snapshots, tool calls, results, cancellation, and
approvals. Both peers parse untrusted input at a security boundary. The contract
must evolve without coupling its compatibility to an npm package, Rust crate, pack
manifest, or MCP specification release.

The bridge also exposes MCP to external clients. MCP `2026-07-28` introduced a
modern stateless lifecycle, while older clients use the legacy initialization
handshake. That compatibility concern is separate from the extension protocol.

## Decision

### Canonical format

Use JSON Schema 2020-12 as the source of truth for MCPatch bridge messages. Store
schemas, valid golden messages, and invalid fixtures in `packages/protocol`.
Implement Rust and TypeScript bindings against the same fixtures.

Every bridge message is one JSON object with:

- `protocolVersion`: a positive integer;
- `type`: a closed message discriminator;
- a request or correlation identifier when the message participates in a call; and
- type-specific fields.

The JSON object is independent of transport framing. Native Messaging supplies its
own framing; local IPC adapters use a bounded length-prefixed frame.

Schemas are closed with `additionalProperties: false`, except for explicitly opaque
JSON values such as tool arguments, tool results, and JSON Schemas. Version 1 does
not silently ignore unknown message fields or message types. This avoids parser
differentials at the cost of requiring a negotiated protocol change for additions.

### Negotiation

Each new authenticated bridge connection begins when the transport initiator sends
`hello`, containing a set of supported protocol versions and implementation
metadata. The acceptor selects the highest mutually supported version and returns
`hello_ack`, including its supported set. The initiator recomputes the highest
common version from both advertised sets, so a lower shared or unadvertised
selection is rejected as a downgrade. Before the acceptor sends and the initiator
verifies that acknowledgement, all other message types are invalid.

The current runtime uses the version 2 bootstrap envelope. Its
`supportedProtocolVersions` and `selectedProtocolVersion` fields refer to the
application-message protocol, so a peer that does not support protocol 2
can still report incompatibility safely.

Version 1 was the pre-release JSON-only contract. ADR 0010 introduced a bounded
media result field and therefore advanced the closed wire contract to version 2;
the v1 schemas remain available as historical compatibility artifacts.

No shared version closes the connection with a bounded, machine-readable error.
The selected version is repeated on every message and must match the connection.

Version numbers describe wire compatibility, not feature support. Optional features
are advertised as capabilities after negotiation. A peer must not infer support
from product version strings.

### Identifiers and lifecycle

- Request identifiers are opaque ASCII strings of 1–128 characters and are unique
  among active requests on one connection.
- Context identifiers are opaque and scoped to one authenticated connection.
- A capability snapshot replaces the prior snapshot for the same context.
- Unknown context, tool, or request identifiers fail closed.
- Cancellation and capability removal are idempotent.
- Disconnect invalidates every identifier and grant scoped to that connection.

### Error behavior

Parse, schema, state, authorization, routing, timeout, and execution failures use
distinct stable error codes. Human-readable messages cannot be used for program
logic and must not contain credentials, raw page content, or full sensitive
arguments.

Malformed framing, oversized payloads, failed negotiation, and repeated protocol
violations terminate the connection. A valid call that is denied returns a typed
error without executing the capability.

### External MCP compatibility

The bridge initially targets MCP `2026-07-28` over stdio using the official Rust
SDK where its behavior meets MCPatch requirements. The adapter may also serve
`2025-11-25` and earlier clients through the SDK's compatibility path, but the
policy and routing core remains independent of MCP lifecycle details.

MCP tool annotations are informational hints. MCPatch risk and permission policy
is derived only from accepted capability metadata and local policy, never from
client behavior or model interpretation.

## Consequences

- Rust and TypeScript can reject the same malformed inputs using shared fixtures.
- Closed schemas make ambiguous or smuggled fields visible during review.
- Even additive wire fields require a negotiated protocol version or a field that
  was explicitly modeled as extensible.
- Protocol adapters must translate external MCP lifecycle details into a stable
  internal call model.
- Golden fixtures become security-relevant artifacts and require careful review.

## Alternatives considered

### TypeScript types as the source of truth

Rejected because Rust would depend on generated output from an implementation
language, and runtime validation would still need a separate contract.

### Protobuf from the beginning

Deferred. Protobuf provides compact framing and generated types, but inspectable
JSON is more useful while the protocol changes quickly. Payload size is already
bounded, and a future binary encoding can be negotiated without changing the
semantic model.

### Ignore unknown fields for forward compatibility

Rejected for protocol version 1. Silent field handling differences across parsers
can become security bugs. Explicit negotiation provides a clearer compatibility
boundary.

### Reuse the MCP specification for bridge messages

Rejected. Browser contexts, capability origin binding, approvals, pairing, and tab
lifecycle are MCPatch concerns. Exposing them as ad hoc MCP methods would couple
pack/runtime compatibility to the external client protocol.

## References

- [MCP 2026-07-28 release](https://blog.modelcontextprotocol.io/posts/2026-07-28/)
- [Official MCP Rust SDK](https://github.com/modelcontextprotocol/rust-sdk)
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12)
- [ADR 0010: bounded MCP media results](0010-bounded-mcp-media-results.md)
