# MCPatch bridge protocol

This package contains the language-neutral contract between the native bridge and
browser extension. JSON Schema 2020-12 files are canonical; Rust and TypeScript
bindings must pass the same fixtures.

## Version 1

Every message is a closed JSON object with `protocolVersion: 1` and a `type`
discriminator. Unknown fields, unknown types, unsupported versions, invalid formats,
and ambiguous messages are rejected.

The only intentionally opaque JSON locations are:

- capability `inputSchema` and `outputSchema`;
- `tool_call.args` and `approval_required.arguments`; and
- `tool_result.result`.

Opaque means their internal keys are defined by the selected tool, not that they
bypass size, depth, schema, policy, or output validation.

## Message families

| Family       | Messages                                           | Purpose                                       |
| ------------ | -------------------------------------------------- | --------------------------------------------- |
| Handshake    | `hello`, `hello_ack`                               | Version selection and implementation identity |
| Capabilities | `capability_snapshot`, `context_closed`            | Atomic context registry and revocation        |
| Calls        | `tool_call`, `tool_result`, `tool_error`, `cancel` | Typed invocation and cancellation             |
| Approvals    | `approval_required`, `approval_result`             | Trusted UI round trip for a pending call      |
| Lifecycle    | `heartbeat`, `connection_error`                    | Liveness and bounded connection failure       |

Pairing/authentication framing is transport-specific and intentionally not modeled
as a v1 application message. A peer must authenticate the transport before its
`hello` is accepted.

## Lifecycle rules

1. A connection authenticates at the transport layer.
2. Each peer sends `hello`; the receiver selects the highest common version.
3. `hello_ack` fixes the selected version and connection ID.
4. Other messages are invalid until negotiation completes.
5. A complete capability snapshot atomically replaces the prior snapshot for the
   same context only when its revision is newer.
6. Every routed call, result, and approval is bound to context ID, revision, and
   exact normalized origin.
7. Closing a context or connection revokes its capabilities and pending operations.

State rules such as monotonic revisions, unique active request IDs, matching result
routes, and approval expiry require runtime validation in addition to JSON Schema.

## Limits

The transport enforces a maximum encoded message size of 1 MiB before JSON parsing.
Schema limits include 128-character identifiers, 256 capabilities per context, 128
top-level tool argument fields, and bounded descriptions/errors. Runtime validators
must also bound nesting depth, collection sizes, schema complexity, in-flight calls,
and validation time.

## Layout

```text
schema/v1/          canonical modular schemas
fixtures/v1/valid/  one accepted example per message family and edge case
fixtures/v1/invalid/rejected examples with the violated rule in the filename
tests/              schema and fixture integrity tests
```

`schema/v1/message.schema.json` is the root schema. Load every sibling schema by its
`$id` before compiling the root.
