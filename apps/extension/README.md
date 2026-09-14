# MCPatch extension

This workspace contains the Chromium Manifest V3 browser runtime. The current
scaffold registers synchronous service-worker lifecycle listeners and deliberately
has no website or privileged browser access.

## Build

```sh
pnpm --filter @mcpatch/extension build
```

Load `apps/extension/dist` with **Load unpacked** on `chrome://extensions` for local
development. There is no toolbar UI or site capability in this slice.

## Current permissions

None. The manifest contains no `permissions`, `host_permissions`,
`optional_permissions`, content scripts, or externally connectable surface. Future
site access must be optional, requested from a user gesture, and scoped to an exact
enabled pack origin.

The service worker uses package-local ES modules only. Runtime-downloaded code,
`eval`, dynamic code generation, and remote script imports are prohibited by the
pack execution model.
