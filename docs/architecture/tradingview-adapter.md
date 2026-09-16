# TradingView rendered-page adapter

The second reviewed MCPatch real-site pack exposes a narrow chart workflow from
TradingView. It reads the active chart and visible watchlist, resolves bounded
company/ticker queries, and can navigate the active tab to one caller-supplied
canonical symbol. The implementation follows the
bounded observations in
[TradingView public-page reconnaissance](../research/tradingview-2026-09-16.md).

## Authority and activation

Version 1 activates only on `https://www.tradingview.com` paths under `/chart/`.
The extension atomically requests the exact optional host patterns
`https://www.tradingview.com/*` and
`https://symbol-search.tradingview.com/*`; the pack matcher and extractor
independently recheck the page origin and path. The second origin is network
authority only and never receives a content script. Other TradingView pages publish
no pack tools.

The reviewed code is bundled with the extension. It has no downloaded pack code,
main-world injection, caller-provided selector, generic DOM command, browser
automation or captured-request replay. A
document source collects a bounded semantic snapshot and pure extractors validate
it. Service-worker fallbacks always return `TOOL_NOT_FOUND`, so real results can
only originate in an authorized matching page.

Native WebMCP retains precedence. If TradingView publishes an eligible native tool
with the same name, MCPatch resolves that tool before the bundled pack.

## Compatibility fingerprint

The initial fingerprint is `tradingview-chart-semantic-en-v1`. Admission requires:

- an English document and exactly one visible chart region;
- one visible symbol name, interval, and display exchange;
- one bounded current quote in the document title and an accessible chart-canvas
  label whose ticker agrees with that title;
- exactly one finite value for each visible OHLC field; and
- agreement among the title ticker, display exchange, URL symbol when present, and
  active watchlist symbol when present.

The chart canvas may identify TradingView's display provider, such as `BATS`, while
the canonical symbol uses the page's displayed listing exchange, such as
`NASDAQ:AAPL`. The ticker must still agree. Conflicting, duplicate, missing, or
unbounded values fail closed. Version 1 intentionally rejects multi-chart layouts
instead of guessing which pane is active.

The adapter relies only on reviewed semantic attributes and bounded visible text.
Generated CSS classes, hidden application state, cookies, storage, request headers,
and network responses are outside the fingerprint.

## Tool contracts

### `tradingview.current_chart`

This `READ` accepts an empty object and returns the fingerprint, canonical symbol,
ticker, listing exchange, display name, interval, visible candle OHLC values, and
the current displayed quote from the document title. The current quote is separate
from the candle close because a selected historical candle can change visible OHLC
without changing the instrument's live price. Visible currency, absolute and
percentage change, and volume are optional. It returns no markup, selector, node
identity, URL, cookie, token, or opaque site state.

### `tradingview.current_watchlist`

This `READ` accepts an empty object and returns at most 64 visible rows from the
current watchlist. Each row contains its canonical symbol, ticker, finite visible
price, absolute and percentage change, active state, and optional visible volume
and market status. Duplicate symbols, incomplete rows, and non-canonical identities
fail closed.

### `tradingview.change_symbol`

This `ACTION` accepts exactly one `symbol` in canonical uppercase
`EXCHANGE:TICKER` form. The handler repeats strict validation, preserves the
current chart layout path and unrelated query state, sets only TradingView's public
`symbol` query parameter, and schedules same-origin tab navigation. It returns
`{ fingerprint, state: "accepted", symbol }` before the old document is revoked.

The bridge requires its existing argument-bound, expiring, single-use approval
before dispatch. Changing the symbol, route, context, pack, expiry, or approval use
invalidates authorization. The pack cannot accept a URL, selector, script, network
endpoint, market guess, or free-form search instruction.

### `tradingview.search_symbols`

This `READ + EXTERNAL_NETWORK` accepts exactly a trimmed `query` of one to 64
characters and an optional result limit from one to ten. It constructs one fixed
GET to TradingView's public `/symbol_search/v3/` operation, omits credentials,
rejects redirects, enforces an eight-second lifetime, and caps the response at 256
KiB and 64 source records.

The response projection returns only the fingerprint, original query, and unique
canonical candidates with `symbol`, `ticker`, `exchange`, display `label`, explicit
asset type, and optional country/currency. Malformed candidates are omitted;
malformed envelopes and oversized responses fail the call. No URL, request option,
header, body, cookie, token, raw response, or opaque provider field crosses MCP.

## Resource and lifecycle bounds

Collection admits at most four chart regions, examines at most 4,096 chart `div`
elements, returns at most 64 watchlist rows, and bounds every string before it
crosses the page channel. Long aggregate containers are ignored when looking for
small OHLC or change leaves. Cancellation is checked while collecting and before
navigation.

A document-local mutation observer watches only relevant text and semantic
attributes and coalesces reevaluation for 150 milliseconds. Live quote changes are
read on each tool call but do not republish an unchanged capability set. This is a
security property: an unrelated price tick cannot replace the registered route and
revoke an in-flight approval. A changed capability set must be observed twice before
publication, filtering one-render transient states. Navigation, permission removal,
pack disable, a stable compatibility-set change, malformed traffic, or bridge
disconnect revokes the context through the common lifecycle.

## Field verification

The opt-in signed-out smoke in `apps/extension/e2e/tradingview-field.spec.ts` uses
a disposable Chromium profile. The harness only launches the browser and performs
the required extension-enable and trusted one-time approval gestures; every pack
operation is invoked through MCP. The 2026-09-16 run discovered all four tools,
validated both page reads, resolved `NYSE:IBM` through symbol search, approved and
executed the exact symbol change, verified fresh-context readback and
unsupported-path revocation, and deleted the profile without retaining prices or
page data. See the
[TradingView MCP field report](../test-reports/2026-09-16-tradingview-field.md).

## Explicit non-goals

- creating, deleting, or changing watchlist entries;
- creating or changing alerts;
- chart-image transport;
- placing trades or connecting a broker;
- background collection, repeated scraping, or historical data export; and
- reading or exporting credentials, cookies, storage, headers, or request logs.

These operations require additional reviewed contracts rather than a generic
network or browser-control escape hatch.

## Related decisions

- [ADR 0005: pack execution](../adr/0005-pack-execution.md)
- [ADR 0006: permissions and approvals](../adr/0006-permission-and-approval-model.md)
- [ADR 0008: origin-scoped content runtime](../adr/0008-origin-scoped-content-runtime.md)
- [ADR 0009: reviewed read-network authority](../adr/0009-reviewed-read-network-authority.md)
- [Pack resolution and native precedence](pack-resolution.md)
- [Extension page-channel protocol](page-channel-protocol.md)
