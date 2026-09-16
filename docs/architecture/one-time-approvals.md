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

## Prompt budget

Every approval opens a trusted browser prompt, and a hostile or looping MCP client
could otherwise open prompts indefinitely—the realistic way to defeat argument
binding is not to break it but to wear the human down. The bridge therefore
budgets prompts per browser connection and origin, the surface the human sees, so
the budget holds whichever client is asking:

- a site may have six prompts in a burst, refilling one every ten seconds;
- three consecutive non-approvals (denials or expiries) lock the site for sixty
  seconds, and one approval resets the count; and
- a refused prompt fails the call before a nonce is generated or any browser
  message is sent, so the extension never sees it.

The MCP client receives a tool failure telling it to wait; the budget is not a
protocol error, so the model learns the reason rather than a generic rejection.
The extension additionally opens a prompt without stealing focus when the same
window has just seen a denial, so repeated prompts are pulled by the user rather
than pushed at them.

Arguments are canonicalized with RFC 8785 JSON Canonicalization Scheme, prefixed by
a protocol- and policy-version domain separator, and hashed with SHA-256. Values are
bounded to 32 levels, 8,192 nodes, 512 array items, and 256 fields per object before
canonicalization. Integers outside JavaScript's exact safe-integer range are
rejected, avoiding a cross-language hash that silently loses precision.

## Approval message

The authenticated extension connection receives the opaque approval ID, request
and route identity, tool, the bridge-validated arguments the grant is bound to,
their canonical hash, expiry, and the requester (the MCP client's self-reported
name and the bridge-assigned session label). The arguments are the exact
bridge-retained copy the hash commits to, sent after schema validation and only for
calls that need a human decision, so the user approves what will run rather than
an opaque digest. Results, credentials, pack objects, browser objects, and
exception payloads are not approval-message fields, and the arguments are never
logged: the bridge's debug output redacts them, and the extension does not record
them. The requester's client name is untrusted MCP-client input; the bridge trims
it, keeps only short printable ASCII, and otherwise substitutes `unknown client`
so nothing in it can imitate a second prompt line. See the
[protocol v2 approval presentation note](protocol-v2-approval-presentation.md)
for why this shipped as a pre-freeze addition.

The extension opens its own `chrome-extension://` approval page for a maximum of
eight concurrent prompts. The service worker binds each page to the exact browser
tab it created and accepts a decision only from the extension's own ID, exact page
URL, top frame, and internal `mcpatch.approval.v1` port. A website frame, content
script, MCP client, or page opened in another tab cannot answer the prompt.

The page receives only the tool, canonical HTTPS origin, validated arguments,
argument hash, expiry, requester, and opaque approval ID. It uses closed message
shapes and renders values with `textContent`; the arguments are pretty-printed as
JSON into a scrollable block, so markup or instruction-like text inside an
argument is displayed as data. Results, request/context identifiers, credentials,
and website text never enter the presentation channel. The user can approve or deny
once. Tab closure, port disconnect, malformed traffic, UI creation failure, timeout,
duplicate IDs, overflow, bridge cancellation, and bridge disconnect all fail closed.

If the trusted surface is unavailable, the extension retains the earlier
deterministic-denial fallback. Website DOM and model text are never an approval
surface.

## Waiting for the decision

The approval wait happens inside the MCP `tools/call` request. MCPatch does not
use MCP tool-call continuation state or elicitation for the decision, because the
decision must never travel through the MCP client: model text and client-supplied
input are untrusted, and the only approval surface is the extension-owned prompt.
The cost is that the client sees a request that has not returned yet.

To keep that wait legible:

- When the client supplied a progress token, the bridge sends
  `notifications/progress` with a fixed, argument-free message as soon as the
  prompt is dispatched and every ten seconds while it waits, so a client can show
  "waiting for the user" rather than "hung" and reset its own inactivity timers.
- The approval wait is 60 seconds by default and configurable through
  `MCPATCH_APPROVAL_TIMEOUT_SECS`, bounded to 5–300 seconds; values outside the
  range or unparseable are ignored with a logged code. Operators should set the
  client's tool-call timeout above the approval wait plus the 30-second browser
  call timeout.
- If the client stops waiting while the prompt is on screen, the extension keeps
  the prompt visible for eight seconds with a notice that nothing was approved,
  then closes it. The pending record is discarded first, so a decision made during
  the grace period has nowhere to land.

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
