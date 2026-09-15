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
the resulting extension ID. There is no toolbar UI or site capability in this
slice.

The runtime requires Chromium 105 or newer. That is the first release where an
open Native Messaging port keeps an extension service worker alive. A failed
handshake is closed after five seconds; reconnect delays increase from 250 ms to a
five-second ceiling. Messages are not queued or replayed across connections.

## Current permissions

Only `nativeMessaging`. The manifest contains no `host_permissions`,
`optional_permissions`, content scripts, or externally connectable surface. Future
site access must be optional, requested from a user gesture, and scoped to an exact
enabled pack origin.

The service worker uses package-local ES modules only. Runtime-downloaded code,
`eval`, dynamic code generation, and remote script imports are prohibited by the
pack execution model.
