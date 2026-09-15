# Extension page-channel protocol version 1

The page channel is the internal boundary between MCPatch's Manifest V3 service
worker and a top-level isolated-world content runtime. It is not the bridge protocol,
not MCP, and not a pack API. Version `1` is independently negotiated so browser-side
changes do not silently alter either stable boundary.

## Wire and resource limits

Each `chrome.runtime.Port` payload is a UTF-8 JSON text string, not a JavaScript
object. The receiver rejects non-text payloads, duplicate object fields, malformed
JSON, non-JSON whitespace, unknown fields, and frames over 256 KiB before accepting
a message. Parsing is bounded to 32 levels, 8,192 values, 512 array entries, and 256
fields per object. Encoders copy data properties without invoking accessors and
reject sparse arrays, exotic prototypes, functions, symbols, cycles, and non-finite
numbers.

The raw-text choice is deliberate. Chromium's structured-clone message transport
cannot represent duplicate object keys by the time application validation runs.
Keeping a closed JSON frame lets both ends enforce the same parse contract.

## Handshake and binding

The content runtime sends `page_hello` first with the only version it supports. The
service worker accepts the port only after separately validating browser-attested
sender metadata, then returns `page_hello_ack` with an immutable binding:

- random channel ID;
- opaque MCPatch context ID and monotonic revision;
- Chromium tab and document IDs; and
- canonical HTTPS origin.

Every later message repeats the complete binding. It must equal both the accepted
port state and its current authority. Sender identity and enablement are deliberately
outside the JSON message because a content payload cannot attest either one.

The service worker accepts only the fixed internal port name from its own extension,
frame zero, an active document, a bounded tab/document identity, and a canonical
HTTPS sender URL whose origin exactly matches Chromium's sender origin. It allows at
most 128 page ports, four negotiating ports per tab, 64 pending calls per document,
a five-second handshake, and a 25-second call deadline. A newer document for the
same tab receives the next context revision and revokes the previous owner before it
can publish or complete more work.

## Messages

| Direction     | Type                       | Purpose                                     |
| ------------- | -------------------------- | ------------------------------------------- |
| page → worker | `page_hello`               | Offer page protocol support                 |
| worker → page | `page_hello_ack`           | Select version and establish binding        |
| page → worker | `page_capability_snapshot` | Replace one document's available candidates |
| worker → page | `page_tool_call`           | Invoke one exact bound named tool           |
| page → worker | `page_tool_result`         | Return one exact bound JSON result          |
| page → worker | `page_tool_error`          | Return one allowlisted payload-free error   |
| worker → page | `page_cancel`              | Abort one exact pending invocation          |
| page → worker | `page_context_closed`      | Gracefully report document/adapter shutdown |

Calls, results, errors, and cancellations repeat request ID and tool name in addition
to the document binding. A stale or crossed response is therefore invalid even if a
request ID collides.

## Capability payloads

A reviewed pack reports only `{ source: "pack", name }`. The service worker already
owns its immutable manifest and refuses names not declared by the enabled matching
pack.

A native WebMCP candidate may additionally report a bounded title, description,
input schema, and normalized annotations. Version 1 admits only metadata explicitly
marked read-only, non-consequential, and untrusted-content. The native adapter keeps
the browser's opaque registered-tool handle inside the document; it never crosses
this channel.

One pack and one native candidate may share a logical name because deterministic
resolution must select native WebMCP. Duplicates within the same source are invalid.

The content runtime validates and re-encodes adapter discovery before publication,
executes only currently announced names, and validates results before returning
them. Synchronous adapter throws are contained, cancellation uses an `AbortSignal`,
and unloading sends a bounded closure message. Both ends reconnect without replaying
calls. The service worker re-evaluates origin-scoped pack authority before every
snapshot, result, and invocation; removing an authority revokes the whole document
port and its pending work.

The content bundle currently carries an empty adapter and is not statically or
dynamically registered. The service worker authority defaults to deny. Optional host
permission and reviewed-pack enablement are a separate slice, so landing this owner
does not expand site access.

## Explicit absences

There is no message for a selector, DOM query, script, cookie, token, browser storage,
network request, page dump, arbitrary tool registration, permission grant, or
approval. Adding a new message type requires a protocol-version decision, threat
model review, golden fixtures, and direction tests.

Golden frames live under
`apps/extension/fixtures/page-channel/v1`. Runtime validation is implemented without
dynamic code generation in `apps/extension/src/page-channel-*`.
