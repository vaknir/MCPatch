# Argument-bound one-time approvals

The Rust bridge is the sole approval authority. An MCP client, model response,
website, content script, and pack handler cannot create a grant or mark one approved.
Version 1 keeps every pending approval in the elected bridge-core process and loses
all of them on restart.

## Reservation

After exact capability resolution and input-schema validation, a read-only call is
reserved normally. A capability requiring `ACTION` or `SENSITIVE` instead creates a
pending approval bound to:

- protocol version 2 and approval-policy version 1;
- the authenticated browser connection;
- exact context ID, active positive revision, and canonical HTTPS origin;
- the complete accepted capability, including source and immutable pack identity;
- request ID and exact namespaced tool;
- the bridge-retained arguments and their canonical hash;
- issue and expiry times; and
- a fresh 128-bit operating-system-random nonce represented by the opaque approval
  ID.

Pending approvals and active calls share a global bound of 128 reservations. The
normal approval lifetime is 60 seconds and the core rejects configured lifetimes
over five minutes.

Arguments are canonicalized with RFC 8785 JSON Canonicalization Scheme, prefixed by
a protocol- and policy-version domain separator, and hashed with SHA-256. Values are
bounded to 32 levels, 8,192 nodes, 512 array items, and 256 fields per object before
canonicalization. Integers outside JavaScript's exact safe-integer range are
rejected, avoiding a cross-language hash that silently loses precision.

## Approval message

The authenticated extension connection receives only the opaque approval ID,
request and route identity, tool, canonical argument hash, and expiry. Raw arguments,
results, credentials, pack objects, browser objects, and exception payloads are not
approval-message fields and are not logged.

The extension opens its own `chrome-extension://` approval page for a maximum of
eight concurrent prompts. The service worker binds each page to the exact browser
tab it created and accepts a decision only from the extension's own ID, exact page
URL, top frame, and internal `mcpatch.approval.v1` port. A website frame, content
script, MCP client, or page opened in another tab cannot answer the prompt.

The page receives only the tool, canonical HTTPS origin, argument hash, expiry, and
opaque approval ID. It uses closed message shapes and renders values with
`textContent`; raw arguments, results, request/context identifiers, credentials,
and website text never enter the presentation channel. The user can approve or deny
once. Tab closure, port disconnect, malformed traffic, UI creation failure, timeout,
duplicate IDs, overflow, bridge cancellation, and bridge disconnect all fail closed.

If the trusted surface is unavailable, the extension retains the earlier
deterministic-denial fallback. Website DOM and model text are never an approval
surface.

## Atomic consumption

An approval result is accepted only from the pending record's exact authenticated
connection and must carry its exact approval and request IDs. Under the registry
mutex, the record is removed before the decision is processed. Denial, malformed
input, expiry, mismatch, and replay therefore cannot preserve a usable record.

An approved decision yields a non-cloneable in-process grant to the waiting MCP call.
Before creating a browser tool call, the bridge looks up the exact registration the
approval was bound to—its connection, context, and tool—rather than resolving the
tool name again, so a same-named tool that appeared in another tab or browser
profile while the human was deciding can neither receive nor block the approved
call. It then rechecks the protocol and policy versions, expiry, connection,
context, revision, origin, complete capability and pack identity, permission
decision, schema, tool, and canonical argument hash. If the bound registration was
replaced by a newer revision or closed in the interval between the decision and
dispatch, the call fails with the distinct `ApprovalContextChanged` outcome and the
MCP client is told to request a fresh approval; every other discrepancy is an
`ApprovalMismatch`. The grant is moved into this check exactly once. No wire token
is returned to the MCP client.

Navigation, capability replacement, context closure, browser disconnect, explicit
MCP cancellation, approval timeout, and bridge restart revoke pending approval
records. Cancellation sends the same bounded request cancellation used for an active
tool call and closes the matching extension prompt without emitting a stale decision.
Concurrent decisions have one mutex-serialized winner; every later decision is an
unknown replay.

## Dependencies

- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
- `serde_json_canonicalizer` 0.3.2 for JCS serialization
- `sha2` 0.10.9 for SHA-256
- `getrandom` for operating-system entropy
