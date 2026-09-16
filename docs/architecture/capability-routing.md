# Capability registry and routing

The bridge registry is the authoritative mapping from an MCP tool name to one
authenticated browser connection, context, revision, and exact HTTPS origin. It
accepts only validated MCPatch protocol messages and never asks browser or page
content to make a policy decision.

## Registry state

Each bridge-assigned connection owns a bounded set of context snapshots. A snapshot
contains a context ID, monotonically increasing revision, origin, and complete tool
set. Applying a newer snapshot atomically replaces the prior state. An exact replay
is a no-op; a stale revision or different data at the same revision is rejected.

Closed contexts retain a bounded revision tombstone so an old snapshot cannot
resurrect capabilities after navigation or tab closure. Replacing or closing a
context revokes its pending calls. Disconnect removes every context and pending call
for that connection.

## Visibility and collisions

Tool names are sorted for stable discovery. A name is visible only when it resolves
to exactly one live context. If two tabs or connections advertise the same name,
the bridge hides it and rejects calls as ambiguous; update arrival order never picks
a winner. Protocol version 2 does not infer an active tab.

Native WebMCP versus pack precedence is resolved by the extension before it sends a
complete snapshot. Duplicate names inside one snapshot are invalid protocol data.

Capabilities with permissions that are always denied are not advertised. Action or
sensitive capabilities may be advertised, but dispatch requires a bridge-owned,
argument-bound one-time approval presented by the extension-owned, tab-bound UI.
If that trusted surface cannot present the request, the extension deterministically
denies it.

## Call routing

For each call, the registry:

1. validates and reserves a unique request ID;
2. resolves one exact capability or fails closed;
3. applies the fixed permission policy;
4. validates arguments against the registered JSON Schema;
5. for elevated tools, creates and atomically consumes the exact pending approval;
6. creates a tool call containing the registered context, revision, and origin; and
7. records a revocation token and one-shot completion channel before dispatch.

JSON Schema draft 2020-12 validators are compiled when a snapshot is accepted.
Schema depth and node counts are bounded. HTTP and file resolver features are not
compiled into the bridge, so a pack schema cannot trigger bridge-originated network
or filesystem reads.

Responses are accepted only from the original connection with the exact request,
context, revision, and origin. Declared output schemas are enforced. A valid result,
tool error, invalid result, cancellation, context replacement, or disconnect consumes
the pending request once. Completion data is delivered directly to the reserving
call; no polling or shared response buffer is used.

MCP request IDs are not forwarded across the browser boundary. The core creates an
opaque request ID for each routed call and uses it only for exact correlation. MCP
cancellation and the fixed call deadline atomically remove the pending request before
sending a best-effort cancellation to the browser. Late responses therefore fail as
unknown requests and cannot be attached to another call.

## Initial bounds

- 8 browser connections per bridge core;
- 64 live contexts and 128 remembered context identities per connection;
- 1,024 capabilities per connection;
- 128 in-flight requests globally;
- 4,096 nodes and depth 32 per input or output schema; and
- 1 MiB at protocol framing boundaries.

These are defensive product limits, not protocol compatibility promises. Changes
must preserve bounded behavior and include denial-path tests.
