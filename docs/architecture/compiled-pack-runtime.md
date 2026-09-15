# Compiled pack extension runtime

The Manifest V3 service worker has a generic runtime for reviewed packs compiled
into the extension release. It replaces the earlier hand-written demo dispatcher;
the synthetic demo now uses the same `definePack` and `defineTool` boundary intended
for future repository-built adapters.

## Definition admission

The runtime accepts only local definition objects with exactly `manifest` and
`handlers`. Before a definition can participate in resolution, it requires:

- a valid, detached Pack Manifest v1 with `execution.kind` equal to `bundled`;
- MCPatch runtime and bridge protocol compatibility;
- every declared permission to fit the runtime's explicit permission ceiling;
- one data-only function entry for every declared tool and no extra handlers;
- one installed version for each publisher/pack ID pair; and
- input and output schemas supported by the extension's codegen-free interpreter.

The Node.js fixture harness remains the complete Draft 2020-12 compatibility check
for reviewed builds. The extension deliberately does not bundle Ajv because Ajv's
runtime compiler uses dynamic function generation, which conflicts with the MV3
runtime policy. Its smaller interpreter supports the schema subset needed by the
current pack: primitive types, `const`, `enum`, object properties and required keys,
closed or schema-bound additional properties, homogeneous array items, and bounded
string, numeric, array, and object sizes. An unsupported keyword rejects the entire
definition instead of being ignored. The extension build itself fails if generated
service-worker output contains `eval` or `Function` calls.

## Context resolution and publication

An activation supplies an opaque context ID, exact page URL, and already-adapted
native WebMCP candidates. A browser-page activation also supplies the pack tool names
reported over its authenticated page channel and narrow handlers that invoke that
same document. Before resolution, the runtime projects each matching pack manifest
to that reported subset. An extension-local activation omits this page projection
and can use its reviewed compiled handlers.

The SDK canonicalizes the URL, applies exact manifest path matching, and resolves
capabilities in stable name order:

1. exactly one native WebMCP candidate;
2. otherwise exactly one matching enabled pack; or
3. no capability when either source is ambiguous.

Native and pack values are opaque to the resolver. A reported page tool that is not
declared by a pack matching the exact page rejects activation. For a selected
page-backed pack tool, the runtime requires the page handler and never falls back to
the service-worker manifest handler. The extension converts only winning typed
metadata into a complete protocol snapshot. It stores a route only after that
snapshot passes the negotiated session's protocol validator and is sent
successfully. A nonmatching or fully ambiguous context publishes nothing.

The service worker activates one extension-local synthetic URL after bridge
negotiation. This keeps a transport proof available without a tab API, content
script, host permission, website, cookie, or credential.

## Calls and revocation

A call must match the active context ID, monotonic revision, canonical origin, and
resolved tool name. Its arguments must pass the codegen-free input validator before
the one exact handler runs. The handler receives only `contextId`, exact `origin`,
and an `AbortSignal`. Results are validated against the declared output schema
before they can be sent; ordinary exceptions become a generic typed error, while
`PackToolExecutionError` preserves only its allowed code.

Pending calls are keyed by bridge request ID. Cancellation aborts one exact call.
Navigation, pack disable, and definition replacement close the old context revision
and abort all of its pending calls. Definition replacement is fail-closed: an
invalid replacement revokes old definitions and leaves no enabled pack. An
unexpected native-session disconnect clears and aborts local state without trying
to send on the dead port; bridge connection cleanup independently revokes the old
snapshot. Reconnection reevaluates the synthetic context with a fresh revision.

## Real-site status

The document owner, bounded page channel, stable local identity, installer, and
user-gesture enablement reconciler exist. The isolated content runtime projects the
same-origin read-only subset of the draft `document.modelContext` API and the static
reviewed Google Flights adapter. Deterministic Chromium fixtures exercise a
page-backed pack through the real Native Messaging and MCP processes. The Google
Flights compatibility fingerprint still requires a fresh signed-out field smoke;
public distribution still requires platform signing and release provenance.

The bridge now enforces one-time approvals for action and sensitive tools. The
trusted approval UI is a later product slice; until it exists the extension denies
every elevated request.

The manifest carries only the baseline APIs accepted by ADR 0008 and one Google
optional-origin declaration for the bundled reference pack. The synthetic pack
remains excluded from site authority and is only a lifecycle/routing proof.
