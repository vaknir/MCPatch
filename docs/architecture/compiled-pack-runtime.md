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
native WebMCP candidates. The SDK canonicalizes the URL, applies exact manifest path
matching, and resolves capabilities in stable name order:

1. exactly one native WebMCP candidate;
2. otherwise exactly one matching enabled pack; or
3. no capability when either source is ambiguous.

Native and pack values are opaque to the resolver. The extension converts only the
winning typed metadata into a complete protocol snapshot. It stores a route only
after that snapshot passes the negotiated session's protocol validator and is sent
successfully. A nonmatching or fully ambiguous context publishes nothing.

The current service worker activates one non-resolving synthetic URL after bridge
negotiation. This proves the boundary without a tab API, content script, host
permission, website, cookie, or credential.

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

## Remaining real-site work

The document owner, bounded page channel, and user-gesture enablement reconciler now
exist. Remaining slices before a real website can complete the path are:

- a native `document.modelContext` detector and validated adapter;
- approval enforcement for action or sensitive tools; and
- installer, stable extension identity, signing, and compatibility attestation.

The manifest now carries only the baseline APIs accepted by ADR 0008 and a dormant
Google optional-origin declaration for the Phase 7 reference pack. The synthetic
pack remains excluded from site authority and is only a lifecycle/routing proof.
