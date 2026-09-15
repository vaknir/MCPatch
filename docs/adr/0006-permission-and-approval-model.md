# ADR 0006: Enforce deny-by-default permissions and bound approvals

- Status: Accepted
- Date: 2026-09-15
- Issue: [#7](https://github.com/vaknir/MCPatch/issues/7)

## Context

Tool schemas describe shape, not authority. MCP tool annotations are hints and may
be produced by untrusted code. MCPatch needs local, deterministic policy that can
distinguish bounded reads from actions, sensitive data access, credential access,
external networking, and arbitrary execution.

Approval for a natural-language description is insufficient: an agent could change
the tool, origin, or arguments after the user approves, or replay the decision.

## Decision

### Permission classes

Permissions are non-exclusive and assigned by the accepted installed pack metadata,
then validated against actual tool behavior:

| Permission            | Meaning                                      | Version 1 default           |
| --------------------- | -------------------------------------------- | --------------------------- |
| `READ`                | Read bounded, task-specific page state       | May run for an enabled pack |
| `ACTION`              | Change website or account state              | One-time approval per call  |
| `SENSITIVE`           | Read or change private/high-impact data      | One-time approval per call  |
| `CREDENTIAL`          | Access authentication/session material       | Always denied               |
| `EXTERNAL_NETWORK`    | Extension request outside exact pack origins | Denied                      |
| `ARBITRARY_EXECUTION` | Generic script or browser automation         | Always denied               |

All permission checks default to deny. Missing, unknown, contradictory, or
unsupported permissions reject pack activation or tool dispatch. `READ` does not
mean harmless: a tool that reads private or high-impact content must also declare
`SENSITIVE`.

Version 1 origins are exact normalized HTTPS origins: scheme, ASCII host, and
effective port. Path matching is a separate activation constraint and never widens
an origin. Wildcard schemes, wildcard hosts, opaque origins, embedded credentials,
and `<all_urls>` are invalid.

MCP annotations such as `readOnlyHint` and `destructiveHint` are derived for client
display. They do not change MCPatch policy.

### One-time approvals

For each call requiring approval, the bridge creates a pending record containing:

- protocol and policy version;
- authenticated connection and context identifiers;
- immutable pack publisher, ID, version, and content digest;
- exact tool name and normalized origin;
- SHA-256 hash of canonical arguments;
- issued-at and expiry timestamps;
- cryptographically random nonce; and
- `uses = 1`.

Arguments are canonicalized with RFC 8785 JSON Canonicalization Scheme after input
schema validation. The hash uses a domain-separated byte sequence so it cannot be
confused with a content digest from another feature.

The bridge retains the authoritative pending record. The extension displays the
exact action in trusted UI and returns the opaque nonce and decision over the
authenticated connection. The browser approval message contains the route, hash,
expiry, and opaque nonce but never raw arguments or results. Approval does not arrive
through website content, tool arguments, MCP descriptions, or model text.

Before dispatch, the bridge atomically consumes the record and rechecks every bound
field plus current context/origin state. The call is denied if:

- arguments, origin, context, connection, pack identity, or tool changed;
- the approval expired or policy version changed;
- the nonce is unknown, malformed, already consumed, or cancelled;
- navigation or capability replacement occurred; or
- state cannot be checked reliably.

Pending approvals are memory-only in version 1 and expire on bridge restart. Error
messages reveal only an opaque request ID and stable error code.

The trusted frontend is an extension-owned page opened and tracked by the service
worker. Its internal protocol is deliberately smaller than the bridge protocol and
contains no raw arguments or results. The worker binds a pending prompt to its exact
extension ID, URL, top frame, and created tab before accepting a one-time decision.
Malformed traffic, closure, cancellation, timeout, overflow, or presentation failure
denies or discards the request. When this surface is unavailable, the runtime denies
the approval deterministically; packs and website DOM cannot fill that role.

## Consequences

- A user decision cannot authorize a modified or replayed call.
- Approval state requires atomic storage and race tests.
- Every site write waits for an exact decision in trusted MCPatch UI in version 1.
- Broader user policies, if added later, must be at least as specific and require a
  new ADR.
- Canonicalization is security-sensitive and must use one tested implementation
  across approval creation and consumption.

## Alternatives considered

### Trust MCP tool annotations

Rejected. The MCP specification treats annotations as hints and warns clients not
to make security decisions from untrusted annotations.

### Approve a tool name for the session

Rejected. It permits argument substitution and excessive reuse, especially after
navigation or capability updates.

### Let the pack request approval directly

Rejected. The pack and page are not trusted approval surfaces. The bridge owns the
pending decision and verifies the response.

### Persist approvals across restart

Deferred. Persistence increases replay and secure-storage complexity and is not
needed for one-time version 1 grants.

## References

- [MCP tool schema and annotations](https://modelcontextprotocol.io/specification/2026-07-28/schema#tool)
- [RFC 8785: JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
