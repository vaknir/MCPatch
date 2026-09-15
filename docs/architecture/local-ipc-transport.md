# Local IPC transport

MCPatch uses local operating-system streams instead of a loopback network listener.
The transport has separate browser and MCP endpoints, so endpoint selection fixes
the parser role before any untrusted frame is read.

## Shared framing

Local IPC frames use a four-byte unsigned little-endian length followed by one
UTF-8 JSON payload. Length zero, a declared or emitted payload above 1 MiB, a
truncated header or payload, invalid JSON, and duplicate object keys terminate the
session. The length is checked before allocating the payload.

This is intentionally independent from Chromium's native-endian Native Messaging
framing and MCP's newline-delimited stdio framing. Adapters must translate at each
boundary rather than forwarding raw transport frames.

## Unix implementation

On Linux, the runtime base is `XDG_RUNTIME_DIR`. On macOS it is the process's
platform temporary directory. MCPatch refuses a relative base and verifies the base
itself with no-follow metadata before use: it must be a directory, owned by the
effective process user, with mode `0700`.

MCPatch then creates and re-verifies these channel-separated directories as mode
`0700`:

```text
<runtime-base>/mcpatch/development/
<runtime-base>/mcpatch/production/
```

Each contains fixed transport-versioned socket names:

```text
browser-v1.sock
mcp-v1.sock
```

Socket nodes must be Unix sockets owned by the expected UID with mode `0600`.
Both accepted clients and connecting adapters read kernel peer credentials and
require the peer UID to match before returning an authenticated stream. The expected
UID is obtained through peer credentials on an in-process Unix socket pair, avoiding
an ambient username or environment-variable identity claim.

After the future bridge core wins protected singleton election, it may call the
explicit `bind_after_election` primitive. Binding probes a pre-existing safe socket
for at most 250 ms. A successful or indeterminate probe is treated as a live owner;
only a failed probe of the same device/inode is reclaimed as stale. Regular files,
symlinks, wrong owners, permissive modes, and identities changed during inspection
are preserved and rejected.

The listener records the device/inode it created. On drop it removes only a socket
with that same identity and owner, so it cannot delete a replacement path. The
private runtime directory is never recursively removed by production code.

## Windows implementation

Windows uses fixed, channel- and role-separated byte-mode named pipes:

```text
\\.\pipe\MCPatch-development-browser-v1
\\.\pipe\MCPatch-development-mcp-v1
\\.\pipe\MCPatch-production-browser-v1
\\.\pipe\MCPatch-production-mcp-v1
```

The bridge reads its process-token logon SID and creates an explicit protected DACL
with one allow ACE granting only generic read and write to that SID. It does not add
Everyone, anonymous, administrator, or broad system ACEs. Handles are non-inheritable,
remote clients are rejected, and the first server instance uses Windows
first-pipe-instance semantics so a pre-existing server makes binding fail closed.

After accepting a client, the listener impersonates it only long enough to query the
effective thread token's logon SID. The token must match the expected logon SID before
the stream is returned or any frame is parsed. Reversion is checked immediately; an
RAII guard remains in scope as a fallback during every error path. The authenticated
blocking stream uses the same bounded little-endian JSON framing validators as Unix.
Issue #45 will isolate blocking Windows accepts and streams on bounded bridge-core
worker threads rather than blocking Tokio executor threads.

## Current scope and residual risk

These slices provide platform transport primitives only. They do not start a bridge
core or connect either adapter; protected process election, bounded startup, adapter
rendezvous, and lifecycle are tracked in
[#45](https://github.com/vaknir/MCPatch/issues/45).

No path-based design can distinguish a hostile process already running as the same
interactive user. Private Unix directories and peer UIDs, protected Windows DACLs and
logon-SID verification, and first-instance checks prevent cross-user access and
accidental replacement; the threat model's same-user residual remains explicit.
