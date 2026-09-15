# Negotiated browser sessions

The bridge core, not the Native Messaging adapter, owns browser protocol state.
The adapter authenticates the extension caller, preserves framing boundaries, and
relays one connection without interpreting its lifecycle. The authenticated browser
endpoint then runs this state machine:

1. wait at most five seconds for the first complete local frame;
2. require a validated version-1 bootstrap `hello` with role `extension`;
3. select the highest version advertised by both peers and return the bridge's set
   so the extension can verify that choice;
4. assign a fresh opaque connection ID scoped to the current bridge-core process;
5. write `hello_ack` and only then register the connection; and
6. require a valid heartbeat at least once every 45 seconds until disconnect.

The ID identifies registry ownership; it is not a bearer credential. Local transport
authentication remains the authorization boundary. Browser IDs use a dedicated
random namespace rather than exposing the private core epoch. IDs are never reused
within one core process and a restarted core uses a different namespace.

## Message and queue boundaries

Each negotiated connection has bounded inbound and outbound queues with capacity 16.
The bridge accepts extension-to-bridge message families and permits only
bridge-to-extension message families on its outbound API. Repeated handshakes,
wrong-version traffic, reversed call/result direction, malformed input, queue
saturation, or a partial-frame failure terminates that browser session. A failed
session does not terminate the shared core or unrelated MCP sessions.

Ready sessions consume heartbeats and peer lifecycle errors, apply complete
capability snapshots atomically, close exact context revisions, and accept tool
results or errors only when the registry binds them to the originating connection,
context revision, origin, and request. Snapshot replacement and context closure
dispatch cancellation for affected calls after releasing the registry lock. Stale,
conflicting, mismatched, or otherwise invalid lifecycle traffic terminates that
browser session through the same disconnect cleanup path. Approval results remain
unsupported until the approval runtime exists and therefore fail closed.

## Revocation

Registration starts only after the acknowledgement is written. Every exit path closes
the transport-backed connection and removes its exact connection ID from the shared
capability registry. Registry removal atomically removes its contexts and cancels its
pending calls. No message is buffered for a later connection, and a reconnect receives
a new identity.

Production bounds are intentionally independent:

- at most eight authenticated browser streams per core;
- at most 16 queued messages in either direction per negotiated stream;
- at most one MiB per framed message;
- five seconds for the initial handshake and for a stalled partial frame; and
- 45 seconds without a valid heartbeat before revocation.

Tests use injected shorter deadlines and deterministic connection namespaces. Unix
and Windows core paths construct the same session manager and shared registry, so the
platform transports do not define protocol behavior.

## Extension-side supervision

The Manifest V3 service worker owns exactly one `runtime.connectNative` port to the
fixed production host name `dev.mcpatch.bridge`. It installs startup and installation
listeners synchronously before opening the port. The extension sends `hello`, waits
at most five seconds for `hello_ack`, recomputes the highest common version from the
bridge's advertised set, and exposes the assigned connection ID only after that
check succeeds.

While ready, the extension sends a heartbeat every 15 seconds. Malformed,
wrong-version, wrong-direction, and fatal messages close the port. Disconnects retry
after 250 ms, 500 ms, one second, two seconds, and then five seconds; every timer is
kept below Chromium's 30-second worker idle interval. A reconnect creates a fresh
session and does not queue or replay application traffic from the prior connection.

Once negotiation succeeds, the extension generates a complete snapshot for one
bundled `mcpatch.demo.status` read capability. Its extension-owned context uses the
non-resolving synthetic origin `https://demo.mcpatch.invalid` and has no browser or
site access. Calls are accepted only when context, revision, origin, tool, and empty
arguments match exactly; other valid calls receive a typed, non-retryable error.
Reconnects generate a fresh context revision, while an explicit stop sends
`context_closed` before disconnecting when the port can still deliver it.

The extension targets Chromium 105 or newer because an open Native Messaging port
has kept extension service workers alive since that release. Its manifest grants
only `nativeMessaging`; this session layer has no website authority, content script,
external messaging surface, dynamic code generation, or remote code.
