# MCPatch extension

This workspace contains the Chromium Manifest V3 browser runtime. Its service
worker synchronously installs lifecycle listeners, owns one long-lived Native
Messaging port to `dev.mcpatch.bridge`, negotiates protocol version 1, and sends a
heartbeat every 15 seconds while connected.

## Build

```sh
pnpm --filter @mcpatch/extension build
```

The build bundles the shared protocol validator into a single local service-worker
module and copies the manifest. Load `apps/extension/dist` with **Load unpacked** on
`chrome://extensions` for local development. The native-host manifest must allow
the resulting extension ID. There is no toolbar UI or real-site capability in this
slice.

The runtime requires Chromium 105 or newer. That is the first release where an
open Native Messaging port keeps an extension service worker alive. A failed
handshake is closed after five seconds; reconnect delays increase from 250 ms to a
five-second ceiling. Messages are not queued or replayed across connections.

## Built-in demo capability

After negotiation, the extension publishes one bundled read-only tool,
`mcpatch.demo.status`, under the reserved synthetic origin
`https://demo.mcpatch.invalid`. Calling it with an empty object returns the fixed
result `{ "status": "ready" }`. The runtime binds calls to that exact context,
revision, origin, tool name, and closed input schema. It republishes a new complete
snapshot after reconnect and closes the context before an explicit runtime stop.

This capability is a transport and routing proof point. It does not inspect an open
tab or website, and its bundled-pack digest is a stable demo identity rather than a
marketplace signature.

The cross-platform automated workflow that exercises this contract through the real
Native Messaging and MCP stdio processes is documented in
[../../docs/local-demo.md](../../docs/local-demo.md). Loading the extension unpacked
does not yet install or authorize the native-host manifest automatically.

## Current permissions

Only `nativeMessaging`. The manifest contains no `host_permissions`,
`optional_permissions`, content scripts, or externally connectable surface. Future
site access must be optional, requested from a user gesture, and scoped to an exact
enabled pack origin.

The service worker uses package-local ES modules only. Runtime-downloaded code,
`eval`, dynamic code generation, and remote script imports are prohibited by the
pack execution model.
