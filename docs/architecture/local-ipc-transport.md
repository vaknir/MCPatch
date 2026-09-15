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

Public adapters use the platform-neutral `LocalRuntime` and `LocalCoreConnection`
boundary. Runtime preparation and authentication of the selected fixed role endpoint
happen before a connection is returned. The boundary exposes only bounded JSON-frame
send and receive operations and classifies unavailable, unauthorized, unsafe-runtime,
malformed-frame, and transport failures with stable payload-free codes. It does not
queue application messages while disconnected.

Adapter startup uses a transport-independent, connect-first rendezvous policy. It
attempts the authenticated fixed endpoint before invoking a process starter, invokes
that starter at most once, and retries only `local_core_unavailable`. Authorization,
unsafe-runtime, malformed-frame, and transport failures are terminal. Retries use
capped exponential backoff with integer jitter and share one two-second monotonic
deadline with the initial connection and process start. Startup failures expose only
stable payload-free classifications: `core_startup_entropy_unavailable`,
`core_spawn_failed`, and `core_startup_timeout`. The policy neither accepts nor stores
application frames, so there is no disconnected message queue.

The production composition resolves the running MCPatch executable through the
operating system, never through `PATH` or an environment-provided command. It supplies
only the fixed `bridge-core` and install-channel arguments and sets the child working
directory to the executable's installation directory rather than inheriting an MCP
client's project directory. Entropy for retry jitter is requested only after the first
authenticated connection reports that the endpoint is unavailable; a ready core
therefore does not depend on startup entropy or process creation.

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

Each channel also has a persistent `core-v1.lock` regular file with mode `0600`.
The core opens it with close-on-exec and no-follow flags, then verifies the opened
file and visible path have the expected owner, mode, link count, device, and inode.
It takes a non-blocking exclusive advisory lock before binding either endpoint. A
contending core exits deterministically; an unlocked file left by a crash is reused
after the same checks, so recovery never depends on deleting a guessed PID file.

Socket nodes must be Unix sockets owned by the expected UID with mode `0600`.
Both accepted clients and connecting adapters read kernel peer credentials and
require the peer UID to match before returning an authenticated stream. The expected
UID is obtained through peer credentials on an in-process Unix socket pair, avoiding
an ambient username or environment-variable identity claim.

After the bridge core wins protected singleton election, it binds both role
endpoints through the explicit `bind_after_election` primitive. Binding probes a
pre-existing safe socket for at most 250 ms. A successful or indeterminate probe is
treated as a live owner; only a failed probe of the same device/inode is reclaimed
as stale. Regular files, symlinks, wrong owners, permissive modes, and identities
changed during inspection are preserved and rejected.

The listener records the device/inode it created. On drop it removes only a socket
with that same identity and owner, so it cannot delete a replacement path. The
private runtime directory is never recursively removed by production code.

Every elected core creates a fresh random 128-bit runtime epoch in memory. Runtime
authority will be scoped to that epoch; it is intentionally neither persisted nor
logged. The current core accepts authenticated sessions and drains bounded strict
JSON frames without acting on them. It exits after 30 seconds with no attached peers,
or on a shutdown signal, then drops both identity-tracked listeners and the election
guard.

## Windows implementation

Windows uses fixed, channel- and role-separated byte-mode named pipes:

```text
\\.\pipe\MCPatch-development-browser-v1
\\.\pipe\MCPatch-development-mcp-v1
\\.\pipe\MCPatch-production-browser-v1
\\.\pipe\MCPatch-production-mcp-v1
```

Before binding either role, the core acquires an initially owned, session-local
named mutex for its install channel:

```text
Local\MCPatch-development-core-v1
Local\MCPatch-production-core-v1
```

The mutex is created non-inheritable with a protected DACL containing one allow ACE
for the current logon SID. That ACE grants only synchronization and mutex state
rights (`0x00100001`). A dedicated election thread owns and releases the mutex,
because Win32 mutex ownership is thread-bound. A second creator exits without
touching the first core's pipes; after clean release or process termination, a new
core can acquire the same name.

The bridge crate remains free of unsafe code. The small `mcpatch-windows-kernel`
crate contains the missing raw named-mutex calls and the `PeekNamedPipe` availability
probe; all other code in that crate denies unsafe operations. Its mutex guard is
deliberately not `Send`. This keeps the thread-affine kernel contract and pipe probe
explicit instead of hiding them behind an unrestricted utility layer.

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
Connecting adapters query the named-pipe server process ID, open only the limited
process-query right needed for token inspection, and require its logon SID to match
before sending or parsing a frame.
The bridge core isolates polling accepts and nonblocking session reads on two accept
workers and at most eight session workers per role, never on Tokio executor threads.
Before each nonblocking read, a narrow `PeekNamedPipe` probe distinguishes a connected,
empty pipe from a disconnected peer; `PIPE_NOWAIT` reads alone do not preserve that
distinction reliably through all library wrappers.
Partial frames are retained only up to the shared 1 MiB limit and are disconnected
after five seconds. Worker shutdown is ordered before mutex release.

## Isolated process start

On Unix, the adapter starts the exact current executable with stdin, stdout, and
stderr connected to `/dev/null` and process group ID zero, which creates a process
group separate from the adapter. A dedicated reaper thread is created before the
child; it waits for the child while the adapter remains alive, but dropping its join
handle does not couple the core's lifetime to the adapter. Every MCPatch-owned Unix
descriptor that can exist at this boundary is close-on-exec, including singleton and
transport descriptors.

On Windows, the narrow kernel facade calls `CreateProcessW` with the exact executable
as `lpApplicationName`, a generated command line containing only the fixed arguments,
`bInheritHandles = FALSE`, and `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP`. Its
`STARTUPINFOW` does not opt into standard handles, so the child receives neither the
adapter console nor stdin, stdout, or stderr. The process and primary-thread handles
returned to the adapter are closed immediately. This avoids the unstable Rust handle-
inheritance API while making the security-relevant creation configuration directly
testable.

## Current scope and residual risk

Unix and Windows now provide the internal bridge-core process and lifecycle
primitive, authenticated adapter-side connections, deterministic bounded rendezvous,
and isolated production process start. The Native Messaging adapter now uses the
browser endpoint; MCP stdio adapter wiring follows in
[#57](https://github.com/vaknir/MCPatch/issues/57).
Protocol negotiation remains in
[#38](https://github.com/vaknir/MCPatch/issues/38).

No path-based design can distinguish a hostile process already running as the same
interactive user. Private Unix directories and peer UIDs, protected Windows DACLs and
logon-SID verification, and first-instance checks prevent cross-user access and
accidental replacement; the threat model's same-user residual remains explicit.
