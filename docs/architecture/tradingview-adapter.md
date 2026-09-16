# TradingView rendered-page adapter

The second reviewed MCPatch real-site pack exposes a narrow chart workflow from
TradingView. It reads the active chart and visible watchlist, resolves bounded
company/ticker queries, and can navigate the active tab to one caller-supplied
canonical symbol. It can also return the active chart as bounded native MCP image
content and perform approved single-symbol mutations against the current custom
watchlist. The implementation follows the
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

### `tradingview.capture_chart`

This `READ` accepts an empty object and returns typed metadata plus one native MCP
WebP image. The document adapter requires exactly one compatible visible chart and
composites only visible canvas descendants whose rectangles remain fully inside
that chart region. Output is at most 1,600 × 1,200 and 160 KiB decoded; bounded
lower-resolution attempts are allowed when the first encoding is too large.

The tool cannot capture browser chrome, another tab, an arbitrary selector or
rectangle, DOM text, cookies, storage, request traffic, or a caller-chosen region.
The shared SDK, page channel, bridge protocol, and Rust MCP projection each enforce
the closed one-image result contract.

### `tradingview.add_to_watchlist` and `tradingview.remove_from_watchlist`

These `ACTION` tools accept exactly one canonical `EXCHANGE:TICKER` symbol. After
the bridge consumes a one-time approval bound to the tool, page origin, context,
pack, and exact arguments, the pack reads TradingView's current active custom list
through one fixed same-origin operation. It derives the list ID internally, issues
at most one fixed append or remove request, and re-reads the active list to require
the same identity and requested postcondition.

The browser attaches its authenticated session directly; MCPatch never reads or
returns the cookie. The caller cannot provide a URL, method, headers, body, list ID,
or retry instruction. The response returns only the fingerprint, outcome, symbol,
and bounded watchlist name. Existing desired state returns `already_present` or
`already_absent` without a write. Non-custom lists, redirects, authentication
failures, oversized or malformed responses, changed identity, and uncertain
postconditions fail closed.

### `tradingview.create_price_alert`

This `ACTION + EXTERNAL_NETWORK` tool creates one basic price alert for the exact
compatible active chart. Its five required arguments make every consequential
choice visible in the approval hash: condition (`above`, `below`, or `crosses`),
finite threshold, one-shot or bar-close frequency, one-to-365-day expiry, and a
closed popup/mobile-push notification choice.

The adapter derives symbol and interval from the same strict chart result used by
`current_chart`, then sends at most one fixed POST to TradingView's exact
price-alert origin with the browser session attached. Email, SMS, sound, webhook,
arbitrary message, script condition, caller-selected symbol, URL, headers, and body
are impossible through the tool contract. The result contains the server alert ID
and normalized choices, not the raw response.

A separate bounded list read confirms that the returned ID belongs to the same
canonical symbol. If creation returned an ID but confirmation is unavailable, the
result is explicitly `created_unconfirmed`; the pack does not retry and blocks any
second creation attempt in that document lifecycle. This avoids silently creating
duplicates after an uncertain postcondition.

## Resource and lifecycle bounds

Collection admits at most four chart regions, examines at most 4,096 chart `div`
elements, returns at most 64 watchlist rows, admits at most 16 chart canvases, and
bounds every string before it crosses the page channel. Authenticated watchlist
reads admit at most 1,024 canonical symbols and 256 KiB per response; the complete
operation has an eight-second deadline and no mutation retry. Long aggregate
containers are ignored when looking for
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
operation is invoked through MCP. The final 2026-09-16 run discovered all eight
tools with the exact chart, symbol-search, and price-alert host grants,
validated both page reads, returned one bounded active-chart image, resolved
`NYSE:IBM` through symbol search, approved and
executed the exact symbol change, verified fresh-context readback and
unsupported-path revocation, and deleted the profile without retaining prices or
page data. See the
[TradingView MCP field report](../test-reports/2026-09-16-tradingview-field.md).

Signed-in write verification is intentionally separate: it must use a disposable
account, an explicitly selected test symbol, an initially recorded state, and a
paired add/remove sequence that restores that state. It may invoke only MCP tools
and the extension-owned approval surface. The harness must not click or type into
TradingView, retain profile data, capture credentials, or run in routine CI.

Alert field verification uses a separate disposable signed-in account, a distant
non-triggering threshold, popup-only notification, and a short expiry. It records
the returned alert ID and confirms the server entry through MCP. The operator then
removes that exact ID in TradingView, verifies cleanup, and deletes the profile. An
interrupted run requires manual cleanup by ID before another attempt; creation is
never retried blindly.

## Explicit non-goals

- creating, deleting, renaming, reordering, or replacing whole watchlists;
- deleting, editing, scripting, bulk-creating, or attaching webhooks to alerts;
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
- [ADR 0011: reviewed authenticated session actions](../adr/0011-reviewed-authenticated-session-actions.md)
- [ADR 0012: reviewed external session actions](../adr/0012-reviewed-external-session-actions.md)
- [Pack resolution and native precedence](pack-resolution.md)
- [Extension page-channel protocol](page-channel-protocol.md)
