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

Before reading a frame, the process requires a canonical Chromium extension origin
and authorizes it against one exact configured origin. The current pre-installer
bootstrap reads that exact value from `MCPATCH_ALLOWED_EXTENSION_ORIGIN`; a missing,
invalid, or different value fails closed. Packaging work must replace this bootstrap
with installer-owned channel configuration and an exact `allowed_origins` entry in
the Native Messaging host manifest. Origin values are never logged.

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

## Local channel seam

The relay depends on the object-safe `LocalBrowserChannel` interface. Tests inject a
bounded fake and verify both directions. The executable currently injects a
fail-closed unavailable implementation: clean browser EOF succeeds, malformed input
is rejected at the framing boundary, and a valid message cannot proceed until issue
[#37](https://github.com/vaknir/MCPatch/issues/37) supplies the user-scoped IPC
rendezvous.

This separation keeps Native Messaging's native-endian framing out of the local IPC
implementation, which uses its own little-endian framing and peer-identity checks as
specified by [ADR 0007](../adr/0007-local-ipc-and-core-lifecycle.md).
