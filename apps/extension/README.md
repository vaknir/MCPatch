# MCPatch extension

This workspace contains the Chromium Manifest V3 browser runtime. Its service
worker synchronously installs lifecycle listeners, owns one long-lived Native
Messaging port to `dev.mcpatch.bridge`, negotiates protocol version 1, and sends a
heartbeat every 15 seconds while connected.

## Build

```sh
pnpm --filter @mcpatch/extension build
```

The build bundles the shared protocol validator, the codegen-free pack runtime, and
reviewed example pack into one local service-worker module, then copies the
manifest. It fails if dynamic `eval` or `Function` code generation enters the
bundle. Load `apps/extension/dist` with **Load unpacked** on
`chrome://extensions` for local development. The native-host manifest must allow
the resulting extension ID. There is no toolbar enablement behavior or real-site
capability yet.

The runtime requires Chromium 105 or newer. That is the first release where an
open Native Messaging port keeps an extension service worker alive. A failed
handshake is closed after five seconds; reconnect delays increase from 250 ms to a
five-second ceiling. Messages are not queued or replayed across connections.

## Reviewed synthetic pack

After negotiation, the extension runs the `packs/examples` definition through the
generic compiled-pack admission, exact matching, and native-first resolution path.
It publishes one bundled read-only tool,
`mcpatch.demo.status`, under the reserved synthetic origin
`https://demo.mcpatch.invalid`. Calling it with an empty object returns the fixed
result `{ "status": "ready" }`. The runtime binds calls to that exact context,
revision, origin, tool name, and closed input schema. It republishes a new complete
snapshot after reconnect and closes the context before an explicit runtime stop.

This capability is a transport and routing proof point. It does not inspect an open
tab or website, and its bundled-pack digest is a stable demo identity rather than a
marketplace signature. Calls pass the declared input and output schemas in the
codegen-free runtime before and after the narrow handler. Navigation, disable,
definition replacement, disconnect, and cancellation all revoke bound work.

See [Compiled pack extension runtime](../../docs/architecture/compiled-pack-runtime.md)
for admission, native precedence, lifecycle, and remaining real-site work.

The cross-platform automated workflow that exercises this contract through the real
Native Messaging and MCP stdio processes is documented in
[../../docs/local-demo.md](../../docs/local-demo.md). Loading the extension unpacked
does not yet install or authorize the native-host manifest automatically.

## Current permissions

Only `nativeMessaging`. The manifest contains no `host_permissions`,
`optional_permissions`, content scripts, or externally connectable surface. Future
site access must be optional, requested from a user gesture, and scoped to an exact
enabled pack origin.

ADR 0008 fixes the Phase 6 direction: `storage`, `scripting`, and `activeTab` may be
added as baseline permissions, while each site remains an optional HTTPS host grant.
Reviewed scripts will be registered dynamically in the isolated world, and their
top-level document ports—not `tabs` or `webNavigation`—will own context lifecycle.

The closed, bounded JSON contract for those ports is implemented as page-channel
protocol version 1 and documented in
[Extension page-channel protocol](../../docs/architecture/page-channel-protocol.md).
It contains only handshake, capability refresh, exact call/result/error,
cancellation, and lifecycle messages.

The service worker uses package-local ES modules only. Runtime-downloaded code,
`eval`, dynamic code generation, and remote script imports are prohibited by the
pack execution model.
