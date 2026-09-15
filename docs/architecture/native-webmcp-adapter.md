# Native WebMCP draft adapter

MCPatch complements a website's native WebMCP tools when Chromium exposes the
draft `document.modelContext` API. The adapter is intentionally small and exists
only in the top-level, isolated content runtime. Draft browser objects and behavior
do not enter the stable MCPatch bridge protocol, pack SDK, or Rust bridge.

## Discovery boundary

The adapter detects only the four draft operations MCPatch uses: `getTools`,
`executeTool`, and `toolchange` listener registration and removal. Discovery calls
`getTools()` with no options. Under the current Chromium contract this requests
same-origin tools; MCPatch never supplies `fromOrigins` and independently requires
every returned tool's reported origin to equal the current canonical HTTPS origin.

Discovery accepts at most 128 returned entries. Each accepted entry must be an
ordinary data object with exactly the current draft fields and must provide:

- a valid namespaced MCPatch tool name, bounded non-empty description, and optional
  bounded non-empty title;
- a bounded, data-only input schema whose root declares `type: "object"`;
- the exact current origin; and
- explicit annotations with `readOnlyHint: true`, `consequentialHint: false`, and
  `untrustedContentHint: true`.

Missing, accessor-backed, malformed, cross-origin, unknown, consequential, or
non-read-only metadata rejects that candidate. Unknown draft fields also reject the
candidate so browser API changes do not silently expand authority. If a name occurs
more than once, every native candidate with that name is omitted. Native-versus-pack
selection then follows the existing deterministic resolver: one eligible native
tool wins, while ambiguous native registrations hide the name and never fall back to
a pack.

The projected capability is copied through MCPatch's bounded duplicate-aware page
codec. The original registered-tool object is retained only as an opaque handle in
the document-local adapter. Its `window`, website objects, and browser identity are
never serialized or exposed to the service worker, bridge, or agent.

## Execution and revocation

Calls resolve an exact name to the handle retained by the latest successful
discovery. Arguments are copied through the bounded page JSON codec before
`executeTool(handle, input, { signal })` is called. The exact call `AbortSignal` is
forwarded. Results are copied through the same codec, so accessors, non-JSON values,
cycles, excessive depth, or excessive size become `RESULT_INVALID`.

Website and draft-API exceptions become payload-free `EXECUTION_FAILED` errors.
An aborted signal or browser `AbortError` becomes `CANCELLED`; exception messages
and objects never cross the adapter.

A `toolchange` event synchronously clears all retained handles before requesting a
new snapshot. The page runtime aborts superseded discovery. Document unload closes
the content port, unsubscribes the adapter, aborts pending calls, and causes the
service worker and bridge to revoke that document's context.

## Compatibility posture

As of 2026-09-15, WebMCP is a Web Machine Learning Community Group draft and the
Chromium imperative API remains experimental. Chromium's current API uses
`getTools()` for discovery and `executeTool(registeredTool, inputObject, { signal })`
for execution; the earlier JSON-string input form is deprecated. MCPatch tests this
surface through a synthetic fake rather than depending on browser globals in unit
tests.

Any incompatible draft change should fail detection or metadata admission and be
handled inside this adapter. It must not be papered over by adding main-world
injection, cross-origin discovery, generic JavaScript, or a broader page protocol.

## References

- [Chrome WebMCP imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)
- [WebMCP community draft](https://webmachinelearning.github.io/webmcp/)
- [ADR 0008: origin-scoped content runtime](../adr/0008-origin-scoped-content-runtime.md)
- [Pack resolution and native precedence](pack-resolution.md)
