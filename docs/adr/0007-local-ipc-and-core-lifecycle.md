# ADR 0007: Run one per-user bridge core over local IPC

- Status: Accepted
- Date: 2026-09-15
- Issue: [#34](https://github.com/vaknir/MCPatch/issues/34)

## Context

Chrome launches one Native Messaging host process for a long-lived extension port,
while an MCP client launches a separate stdio process. Capability state, policy,
approvals, and pending calls cannot be copied between those processes without
creating inconsistent security decisions. They need one authoritative bridge core.

The rendezvous must work without opening a port reachable by websites or the local
network. It must resist cross-user access, symlink and stale-endpoint attacks,
unbounded framing, role confusion, startup races, and state reuse after a crash.

## Decision

### Process topology

Run one on-demand `mcpatch bridge-core` process per OS user and install channel. The
production and development channels use different endpoint directories and native
host identities.

Both public adapter modes remain short and replaceable:

```text
Chrome extension
  ↕ Native Messaging
mcpatch native-host
  ↕ browser IPC endpoint
mcpatch bridge-core
  ↕ MCP IPC endpoint
mcpatch mcp-stdio
  ↕ newline-delimited MCP
MCP client
```

The core owns the capability registry, permission policy, approvals, MCP handlers,
and browser sessions. `native-host` translates only bounded Native Messaging frames.
`mcp-stdio` translates only bounded MCP stdio frames. Neither adapter owns a second
copy of registry or policy state.

Use two endpoints, one for browser-protocol sessions and one for MCP sessions. This
avoids a privileged, role-selecting control message on a shared socket. Endpoint
names include a local transport compatibility version so incompatible releases do
not silently exchange frames.

### Unix endpoints

Use Unix domain stream sockets inside a private runtime directory:

- on Linux, prefer `$XDG_RUNTIME_DIR/mcpatch/<channel>` only after verifying that
  the base directory is owned by the effective user and has mode `0700`;
- on macOS, use the per-user temporary directory returned by the platform (the
  `_CS_DARWIN_USER_TEMP_DIR` location), then create an MCPatch child directory;
- on another Unix platform, use its equivalent user-runtime API or fail with a
  bounded setup error if a private local directory cannot be established; and
- create the MCPatch directory as `0700`, reject symlink components and non-directory
  existing nodes, and verify owner and mode again before binding.

The private parent directory is the primary filesystem access boundary. Socket and
lock nodes must still be owned by the effective user and must never be accepted from
a group- or world-writable MCPatch directory.

After `accept`, read peer credentials from the connected Unix socket and require the
peer UID to equal the core effective UID. Failure to obtain credentials or a mismatch
closes the stream before any frame is parsed. Tokio exposes UID, GID, and, on Linux
and macOS, PID through `UnixStream::peer_cred`; MCPatch does not need unsafe code for
this check.

### Windows endpoints

Use separate local duplex named pipes for browser and MCP sessions. Create an
explicit security descriptor; never accept the permissive default descriptor. The
DACL contains only the minimum rights required by the current logon SID; it does not
grant access to Everyone or anonymous users. Reject remote clients and verify the
connected client token has the expected logon SID before parsing a frame. Every
impersonation or token-query call is checked, and the core reverts immediately after
identity inspection.

Use a per-logon, access-controlled named mutex plus first-pipe-instance semantics for
singleton election. Development and production use distinct pipe and mutex names.

### Startup and stale state

An adapter first tries its expected endpoint. If no core is reachable, it starts the
installed MCPatch binary in internal `bridge-core` mode with stdio redirected to null.
Unrelated inherited handles are explicitly excluded. Multiple adapters may race to
start it; only the process that acquires the protected singleton becomes the core,
and losing processes exit.

On Unix, a core holding the singleton lock rechecks the socket after acquisition. It
may remove a stale node only when all of these are true:

1. the path is the exact fixed endpoint inside the verified runtime directory;
2. metadata is obtained without following symlinks;
3. the node is a socket owned by the effective user; and
4. a connection attempt still fails.

The core records the identity of each socket it creates and removes only that node
during graceful shutdown. It never recursively deletes the runtime directory.
Windows named pipes have no persistent filesystem node; a failed singleton owner is
handled by reconnect and bounded startup retry.

Adapters use bounded exponential retry with jitter during startup. They do not buffer
arbitrary frames while disconnected. If startup does not succeed within the fixed
window, they return a stable unavailable error.

### Framing and sessions

Local IPC uses a four-byte unsigned little-endian length followed by one UTF-8 JSON
payload. Length zero, a length over 1 MiB, truncated payloads, invalid UTF-8/JSON, and
malformed JSON terminate that session. The receiver rejects the length before
allocating the payload. Reads, writes, handshakes, and idle heartbeats have explicit
timeouts and bounded queues.

The browser endpoint carries only MCPatch bridge-protocol messages. Its first payload
must be `hello`, and no capabilities or calls are accepted before negotiation. The
MCP endpoint carries only complete MCP JSON-RPC frames and performs the applicable
MCP initialization or request-metadata checks in the core. Native Messaging native-
endian framing and MCP newline framing end at their adapters.

### Lifecycle and recovery

The core creates a fresh random epoch on every start. Connection IDs, contexts,
pending calls, and approvals are scoped to that epoch and are never restored from
disk. A core restart therefore revokes all authority.

When an adapter loses IPC, it closes its outward-facing session. A reconnected
extension negotiates again and sends complete capability snapshots; snapshots are
never reconstructed from logs or stale files. The core exits after a short fixed
grace period with no browser or MCP peers and removes its own Unix socket nodes.

Logs contain stable event codes and bounded non-sensitive identifiers only. IPC
frames, MCP arguments/results, page text, credentials, endpoint secrets, and raw
platform errors are not logged.

### Security boundary

OS ownership, endpoint ACLs, peer credentials, exact Native Messaging
`allowed_origins`, and caller-origin checking authenticate the intended local path
against websites and other OS users. They do not make a strong distinction between
two malicious processes already running as the same interactive user. That remains
an explicit residual risk from the threat model. Code-signing identity or a
platform-protected channel-binding credential is required before claiming protection
against a fully malicious same-user process.

## Consequences

- One process owns every mutable authorization decision.
- No unauthenticated TCP, HTTP, or WebSocket listener is created.
- Adapters stay small enough for focused framing and origin-validation tests.
- Unix and Windows need platform-specific endpoint setup behind one stream interface.
- Startup/install work is more involved than opening a loopback port.
- Core restart is safe but temporarily removes tools until the extension reconnects.
- Strong same-user process isolation is deferred and cannot be represented as solved
  by a readable token file.

## Alternatives considered

### Unauthenticated or tokenized localhost transport

Rejected. A network listener adds browser-origin, DNS-rebinding, firewall, discovery,
and credential-distribution concerns. A bearer token readable by the same user does
not improve the principal boundary enough to justify that surface.

### Keep the core inside whichever adapter starts first

Rejected. Core lifetime would depend on an unrelated Chrome port or MCP client, and
ownership cannot transfer safely when the original adapter exits.

### One multiplexed local endpoint

Rejected for the initial implementation. It requires another privileged role and
stream-multiplexing protocol before existing MCPatch negotiation can run. Separate
fixed endpoints let the OS path select the parser and role.

### Always-running system service

Deferred. A service manager can improve upgrades and crash recovery later, but adds
installer privileges and cross-user design before the on-demand lifecycle is proven.

## References

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [XDG Base Directory Specification](https://specifications.freedesktop.org/basedir/0.8/)
- [Apple secure temporary-file guidance](https://developer.apple.com/library/archive/documentation/Security/Conceptual/SecureCodingGuide/Articles/RaceConditions.html)
- [Tokio Unix peer credentials](https://docs.rs/tokio/1.53.1/tokio/net/unix/struct.UCred.html)
- [Windows named-pipe security and access rights](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights)
- [Windows named-pipe client impersonation](https://learn.microsoft.com/en-us/windows/win32/ipc/impersonating-a-named-pipe-client)
