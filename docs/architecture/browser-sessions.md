# Negotiated browser sessions

The bridge core, not the Native Messaging adapter, owns browser protocol state.
The adapter authenticates the extension caller, preserves framing boundaries, and
relays one connection without interpreting its lifecycle. The authenticated browser
endpoint then runs this state machine:

1. wait at most five seconds for the first complete local frame;
2. require a validated version-1 bootstrap `hello` with role `extension`;
3. select the highest locally supported version advertised by both peers;
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

This first session slice consumes heartbeats and peer lifecycle errors. Other valid
extension-to-bridge application messages currently fail closed instead of being
dropped; capability snapshot and response handling is added with the demo capability
runtime in issue #39.

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
