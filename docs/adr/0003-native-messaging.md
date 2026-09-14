# ADR 0003: Use Native Messaging with local IPC rendezvous

- Status: Accepted
- Date: 2026-09-15
- Issue: [#5](https://github.com/vaknir/MCPatch/issues/5)

## Context

The extension needs a bidirectional connection to the native bridge. It carries
capability metadata, tool calls, results, cancellation, and lifecycle changes. The
channel must not be reachable by arbitrary web pages and should not create a local
network service without a compelling reason.

Chrome Native Messaging provides an extension-only API, an installed native-host
manifest with exact `allowed_origins`, and length-prefixed JSON over stdio. It also
creates a process topology constraint: Chrome launches the native host, while an
MCP client normally launches the MCP stdio server. Those are different processes
and cannot share in-memory capability state.

## Decision

Use Chrome Native Messaging as the extension-facing transport. Use a small native
host mode in the MCPatch binary as the framed adapter, and rendezvous the native
host and MCP stdio mode through a per-user bridge core over operating-system local
IPC:

```text
extension
  └─ Chrome Native Messaging stdio
       └─ mcpatch native-host adapter
            └─ user-scoped local IPC
                 └─ bridge core
                      └─ user-scoped local IPC
                           └─ mcpatch mcp-stdio adapter
                                └─ MCP client
```

The initial bridge implementation keeps this behind a `BrowserConnection`
abstraction and uses an in-process fake. Native Messaging and IPC are added only
after routing and policy behavior are deterministic under tests.

The production channel must enforce these controls:

- the native-host manifest allowlists exactly one production extension origin;
- development builds use a separate host name and extension identity;
- the host verifies Chrome's caller-origin process argument as defense in depth;
- the service worker uses one long-lived `runtime.connectNative` port;
- messages are UTF-8 JSON and follow Chrome's 32-bit native-endian framing;
- MCPatch applies a 1 MiB limit in both directions, regardless of Chrome's larger
  extension-to-host allowance;
- stdout contains protocol frames only and diagnostics go to stderr;
- the IPC endpoint is owned by the current OS user and rejects other users;
- endpoint discovery does not rely on a predictable unauthenticated TCP port;
- each layer repeats protocol version, size, timeout, and state validation; and
- disconnect invalidates the connection's contexts, capabilities, approvals, and
  pending calls.

On Unix, the preferred IPC is a Unix domain socket inside a mode-0700 runtime
directory. On Windows, use a named pipe with an ACL limited to the interactive user.
Platform-specific endpoint details require a follow-up implementation ADR.

## Consequences

- Ordinary websites cannot connect to the native host API.
- Chrome installation must register a platform-specific native-host manifest.
- The exact extension ID becomes part of packaging and release integrity.
- The bridge needs a small local service lifecycle and two adapter modes.
- The same connection and policy core can later support Firefox Native Messaging.
- Integration tests need framing tests plus fake local IPC peers.

## Alternatives considered

### Unauthenticated localhost WebSocket

Rejected. Any page can attempt local network connections, and origin headers alone
do not authenticate a browser extension. Pairing tokens, DNS rebinding defenses,
port discovery, and service lifetime would recreate a weaker browser-to-native
boundary.

### Authenticated localhost HTTP or WebSocket

Deferred as a compatibility fallback. It could be secure with loopback-only
binding, strict Origin validation, high-entropy pairing credentials, replay
protection, and no credential in URLs or logs. Native Messaging provides a smaller
initial attack surface for Chromium.

### One Native Messaging process with no rendezvous

Rejected. The process launched by Chrome cannot simultaneously be the stdio child
launched by an arbitrary MCP client, so it cannot expose live browser capabilities
without another local channel.

### Direct content-script native connection

Impossible in Chromium. Native Messaging is available to extension pages and the
service worker, not content scripts. Content scripts must use internal extension
messaging through the service worker.

## References

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome runtime API](https://developer.chrome.com/docs/extensions/reference/api/runtime)
