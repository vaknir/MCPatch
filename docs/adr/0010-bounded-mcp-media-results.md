# ADR 0010: Bound media results at every capability boundary

- Status: Accepted
- Date: 2026-09-16
- Issue: [#138](https://github.com/vaknir/MCPatch/issues/138)

## Context

Some typed website capabilities naturally return media. A TradingView chart image
is useful to an MCP client, but a generic screenshot tool would give the agent
authority over browser chrome, unrelated page content, arbitrary rectangles, and
future sensitive UI. Putting base64 inside structured JSON would also obscure the
MCP media type and make size enforcement inconsistent.

## Decision

Protocol version 2 tool results may include one optional image content block in
addition to their structured JSON result. The image is a closed object containing
only `type`, `mimeType`, base64 `data`, `width`, and `height`.

Every decoder enforces the same limits:

- exactly one image when `content` is present;
- `image/png` or `image/webp` only;
- dimensions from 1 through 2,048 pixels; and
- at most 160 KiB of decoded canonical base64 data.

The pack SDK creates this envelope through `imageResult(...)` and brands it in
memory. Ordinary site data cannot impersonate an SDK execution envelope. Fixture
validation checks only the structured result, while the page channel, extension,
bridge protocol, and MCP projection independently validate or preserve media. The
Rust bridge emits a standard MCP image content block and keeps dimensions in the
tool's schema-validated structured metadata.

The first producer, `tradingview.capture_chart`, accepts no arguments. It requires
one compatible active chart, composites only visible canvas descendants fully
contained by that reviewed chart region, and emits bounded WebP. It cannot select a
rectangle, capture a tab or browser window, query another origin, or return DOM or
browser state.

Protocol v1 remains the historical closed JSON-only contract. No public MCPatch
release shipped it, and the current bridge and extension negotiate v2 exclusively;
the v1 schema remains in the repository for compatibility review and future
migration work.

## Consequences

- MCP clients receive native typed image content instead of base64 hidden in JSON.
- Media cannot silently enlarge the authority of every pack; each producing tool
  remains a separately reviewed capability.
- The 256-KiB page-channel limit and 1-MiB bridge limit remain above the maximum
  encoded image frame with deterministic headroom.
- More media kinds or multiple blocks require a future protocol decision rather
  than an unbounded backward-compatible interpretation.

## Alternatives considered

### Generic tab screenshot

Rejected because it captures content outside the registered site capability and
cannot enforce the active-chart semantic boundary.

### Arbitrary DOM selector or rectangle capture

Rejected because caller-controlled selection is browser automation authority in
disguise and is not stable or reviewable as a typed site contract.

### Base64 inside structured output

Rejected because MCP already has image content, schemas become burdened with large
opaque strings, and clients cannot reliably distinguish media from data.

### Captured network or HAR image replay

Rejected because chart rendering is already available inside the authorized page,
while request capture risks carrying headers, cookies, tokens, and unrelated
traffic across the trust boundary.
