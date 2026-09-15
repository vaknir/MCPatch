# MCPatch extension

This workspace contains the Chromium Manifest V3 browser runtime. Its service
worker synchronously installs lifecycle listeners, owns one long-lived Native
Messaging port to `dev.mcpatch.bridge`, negotiates protocol version 1, and sends a
heartbeat every 15 seconds while connected.

## Build

```sh
pnpm --filter @mcpatch/extension build
```

The build bundles the shared protocol validator, codegen-free pack runtime, reviewed
example and Google Flights packs, service worker, and isolated-world content
runtime, then copies the manifest. It fails if dynamic `eval` or `Function` code
generation enters either executable bundle. The content artifact is never
registered statically; the enablement controller registers it only for user-approved
reviewed origins. Load
`apps/extension/dist` with **Load unpacked** on `chrome://extensions` for local
development. The native-host manifest must allow the resulting extension ID. The
toolbar enablement flow is active for the bundled Google Flights reference pack.

The committed public `key` fixes unpacked builds to extension ID
`imbnpameklobbabbkfkalcfcggpjacdi`; it is public identity material, not a signing
secret. A clean-checkout `pnpm package:local` build records source provenance and
produces the bridge plus extension together. The packaged bridge's `install`
command registers the exact ID. See [local installation](../../docs/installation.md).

The runtime requires Chromium 106 or newer so each accepted content port has a
browser-attested document ID. An open Native Messaging port keeps the extension
service worker alive. A failed
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
for admission, page routing, native precedence, and lifecycle.

## Reviewed Google Flights pack

The private pre-alpha build includes `packs/google-flights` for the exact origin
`https://www.google.com` and exact paths `/travel/flights` and
`/travel/flights/search`. Its three tools read current search state, visible result
summaries, and a short price insight. They are READ-only, have closed empty inputs,
make no extension network requests, and publish website strings as bounded untrusted
content.

The content adapter is a static build dependency constructed only after the service
worker authorizes its complete declared tool set. A page snapshot limits the pack
manifest to tools actually available in that document, and every selected route is
sent back to that exact document for execution. The manifest's service-worker
handlers intentionally fail closed. Native WebMCP keeps precedence on a name
collision.

The cross-platform automated workflow that exercises this contract through the real
Native Messaging and MCP stdio processes is documented in
[../../docs/local-demo.md](../../docs/local-demo.md). Registration is an explicit
local command because Chromium does not allow an unpacked extension to install its
own native host.

## Current permissions

The baseline permissions are `nativeMessaging`, `storage`, `scripting`, and
`activeTab`. `activeTab` is used only by the toolbar click that identifies the
selected page. The manifest has no permanent `host_permissions`, static content
scripts, or externally connectable surface. Google is the only optional host
authority and can be requested only from a toolbar click on one of the two matching
Google Flights paths.

ADR 0008 fixes the Phase 6 direction: `storage`, `scripting`, and `activeTab` may be
added as baseline permissions, while each site remains an optional HTTPS host grant.
Reviewed scripts will be registered dynamically in the isolated world, and their
top-level document ports—not `tabs` or `webNavigation`—will own context lifecycle.

The closed, bounded JSON contract for those ports is implemented as page-channel
protocol version 2 and documented in
[Extension page-channel protocol](../../docs/architecture/page-channel-protocol.md).
It contains only handshake, capability refresh, exact call/result/error,
cancellation, and lifecycle messages. The service worker now owns top-level
document ports through that contract, validates extension ID, active lifecycle,
frame zero, tab/document IDs, and canonical HTTPS sender origin before handshake,
and atomically replaces a tab context on navigation. Calls, discovery, and retries
are bounded; crossed traffic or revoked pack authority closes the context. Runtime
authority still defaults to deny, remains unavailable until bridge negotiation is
ready, and is revoked with all page state if that bridge session is lost. Content
scripts are never registered statically.

The version 2 acknowledgement carries a worker-derived sorted allowlist of pack
tools. The content runtime uses it to construct only exact matching static reviewed
adapters, rejects undeclared output independently, and routes native WebMCP first on
name collisions.

The extension action now reconciles reviewed pack enablement. It requests only the
matching compiled pack's exact declared origin, stores a bounded v1 identity record
in trusted-context-only local storage, and registers one deterministic top-level
`ISOLATED` content script for that origin. Denial leaves no state. Disable and live
storage/permission changes revoke context authority before removing scripts and
best-effort host access. Unknown packs, changed versions/digests, corrupt records,
registration drift, and API failures all fail closed. See
[Pack enablement reconciliation](../../docs/architecture/pack-enablement.md).

The service worker uses package-local ES modules only. Runtime-downloaded code,
`eval`, dynamic code generation, and remote script imports are prohibited by the
pack execution model.
