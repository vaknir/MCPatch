# TradingView MCP field report — 2026-09-16

Status: **read, bounded image, constrained symbol search, and approved action paths passed locally**

Environment:

- Chromium: 153.0.8010.12
- page language: English
- profile: fresh, temporary, and signed out
- compatibility fingerprint: `tradingview-chart-semantic-en-v1`

Typed tools discovered through MCP:

- `tradingview.current_chart`
- `tradingview.current_watchlist`
- `tradingview.capture_chart`
- `tradingview.search_symbols`
- `tradingview.change_symbol`

Evidence:

- the user enabled only the exact optional `https://www.tradingview.com/*` and
  `https://symbol-search.tradingview.com/*` permissions in the disposable profile;
- the MCP client discovered all five capabilities from the compatible live chart;
- `tradingview.current_chart` returned a schema-valid canonical chart identity,
  interval, finite OHLC/current-price fields, and the expected fingerprint;
- `tradingview.current_watchlist` returned between one and 64 schema-valid visible
  rows with canonical exchange-qualified symbols and finite quote fields;
- `tradingview.capture_chart` returned schema-valid active-symbol metadata and one
  native MCP WebP image within 1,600 × 1,200 and 160-KiB bounds;
- `tradingview.search_symbols` resolved a company-name query through MCP and
  returned `NYSE:IBM` with an explicit stock asset type inside the requested
  five-result bound;
- navigation to an unsupported TradingView path removed all TradingView tools while
  preserving the synthetic bridge-status tool; and
- the browser context closed and the temporary profile was deleted with retry-safe
  cleanup.

The field harness did not click, fill, or type into TradingView and did not use
Playwright as a pack runtime. Playwright only hosted the disposable Chromium
process; reads crossed the real MCP stdio, Rust bridge, Native Messaging, extension,
page-channel, and reviewed pack path.

Security limits:

- no cookies, tokens, captured headers, browser storage, HAR data, or private
  endpoints were read or transported; the search request used a fixed public
  first-party GET with `credentials: "omit"`;
- no live prices, watchlist contents, chart images, raw tool outputs, request logs,
  or browser profile were retained; and
- the pack exposed no generic browser, DOM, JavaScript, fetch, screenshot, or
  request-replay capability.

Bounded image contract:

- capture accepted no selector, rectangle, URL, tab, or browser-surface argument;
- the reviewed page adapter composited only visible canvases fully contained by the
  one compatible active chart region;
- the SDK, page protocol, bridge protocol, and MCP projection preserved one closed
  image block separately from structured metadata; and
- the harness validated the MIME, canonical base64, dimensions, and decoded byte
  bound in memory, then deleted the disposable profile without writing the image.

Approved action contract:

- the field harness now invokes `tradingview.change_symbol` through MCP, waits for
  the extension-owned approval surface, and requires a fresh human approval;
- after approval it requires an exact `NYSE:IBM` acknowledgement, waits for the
  current tab to navigate to the canonical symbol, requires a fresh page context,
  and reads back a schema-valid IBM chart through MCP;
- the trusted prompt displayed exactly `tradingview.change_symbol`,
  `https://www.tradingview.com`, the bridge-owned arguments hash, and an expiry;
- the approved call completed once, the prompt closed, and the old AAPL document
  authority was replaced before the IBM document republished the tool set;
- deterministic tests cover canonical-symbol validation, exact same-origin URL
  generation, one-attempt document state, live-document revalidation, manifest
  `ACTION` classification, and bridge-owned argument-bound one-time approvals.

Known volatility:

- TradingView does not provide a versioned rendered-page contract;
- live quotes mutate continuously, so capability refreshes are filtered by the
  actual tool set instead of republishing on price-only changes; and
- this field pass is compatibility evidence, not a guarantee of future site
  behavior or authorization for background collection.
