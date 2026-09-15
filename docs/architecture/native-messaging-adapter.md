# Native Messaging adapter

The `mcpatch native-host` process is the small Chromium-facing transport adapter.
It does not own capability state or policy and does not inspect browser or website
content. Its only data-plane responsibility is translating between Chromium Native
Messaging frames and typed MCPatch protocol messages on an injected local channel.

## Invocation and caller identity

The command accepts the caller origin supplied by Chromium and its optional Windows
`--parent-window=<decimal-handle>` argument:

```text
mcpatch native-host chrome-extension://<32-character-extension-id>/
mcpatch native-host chrome-extension://<32-character-extension-id>/ --parent-window=42
```

Before reading a frame or attempting local rendezvous, the process requires a
canonical Chromium extension origin and authorizes it against the one stable origin
compiled from MCPatch's committed public extension identity. Environment values
cannot override the policy. The installer emits that same single origin in the
Native Messaging manifest's `allowed_origins`; tests derive the extension ID from
the manifest public key and require exact agreement with the Rust constant. Origin
values are never logged.

Chromium launches the manifest's executable directly, passing the caller origin as
the first argument and the optional Windows parent-window handle as the second. The
binary recognizes that exact direct form. The explicit `mcpatch native-host` form
remains available only for controlled process tests and diagnostics; no wrapper
script or command fragment is generated during installation.

## Framing

Each direction uses a four-byte unsigned length in the platform's native byte order,
followed by exactly that many UTF-8 JSON bytes. MCPatch applies a 1 MiB limit in both
directions even though Chromium permits a larger browser-to-host message.

The reader handles the header before allocating the payload. Zero lengths,
oversized lengths, truncated headers or payloads, invalid JSON, duplicate keys, and
semantically invalid protocol messages terminate the process. The writer validates
and serializes a typed protocol message before writing its header. Partial write or
flush failures also terminate the process.

Standard output is reserved for framed messages. Structured diagnostics contain
only stable event and error codes on standard error; they never include origins,
frames, arguments, results, page text, or raw I/O errors.

## Local channel lifecycle

After origin authorization, the adapter reads and validates one Native Messaging
frame. Clean EOF exits without starting the core, and malformed first input is
rejected before any process or local-transport work. A valid first message triggers
bounded connect-first rendezvous with the fixed browser-role endpoint. The message is
then the first item relayed over that authenticated connection.

The production `LocalBrowserChannel` owns one connection worker and capacity-one
channels in each direction. The runtime awaits every send before reading another
browser frame and does not reconnect or preserve messages after disconnect. This
keeps Native Messaging's native-endian framing separate from local IPC's little-endian
framing without adding an unbounded or disconnected queue. At both framing boundaries,
a partially consumed read remains pinned while the opposite direction progresses so
cancellation cannot desynchronize a subsequent frame. The authenticated local stream
is split into independent read and write halves to support that lifecycle.

Browser EOF or framing failure cancels and joins the worker, which drops the local
connection before the host exits. Local EOF, transport failure, or malformed typed
protocol data is reported to the relay as a stable payload-free error and terminates
the Native Messaging session. Unix and Windows integration tests exercise the real
authenticated local transport; injected tests cover authorization ordering, startup
failure, bidirectional relay, browser failure, and IPC loss.

Tokio implements standard-input reads with a blocking worker that cannot be
cancelled by dropping its async future. After the native-host relay has awaited local
channel cleanup and emitted its terminal diagnostic, its process entrypoint shuts
the runtime down in the background instead of waiting forever on a cancelled stdin
read. The process exit then releases that worker and the browser pipe together.

A bounded cross-platform process scenario also launches the real `mcpatch
native-host` executable against a live bridge core. It carries hello,
acknowledgement, and heartbeat messages across both framing layers; verifies that
pre-negotiation, wrong-version, and wrong-direction traffic terminates only its
browser session; reconnects without replay under a fresh connection ID; and repeats
negotiation after a core restart. The scenario checks that adapter diagnostics remain
JSON lines containing stable codes rather than origins or message data.

This separation keeps Native Messaging's native-endian framing out of the local IPC
implementation, which uses its own little-endian framing and peer-identity checks as
specified by [ADR 0007](../adr/0007-local-ipc-and-core-lifecycle.md). Bridge-protocol
hello/version state is enforced only after the relay reaches the bridge core, as
specified in [Negotiated browser sessions](browser-sessions.md).
