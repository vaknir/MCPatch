# TradingView MCP field report — 2026-09-16

Status: **read path passed locally**

Environment:

- Chromium: 153.0.8010.12
- page language: English
- profile: fresh, temporary, and signed out
- compatibility fingerprint: `tradingview-chart-semantic-en-v1`

Typed tools discovered through MCP:

- `tradingview.current_chart`
- `tradingview.current_watchlist`
- `tradingview.change_symbol`

Evidence:

- the user enabled only the exact optional `https://www.tradingview.com/*`
  permission in the disposable profile;
- the MCP client discovered all three capabilities from the compatible live chart;
- `tradingview.current_chart` returned a schema-valid canonical chart identity,
  interval, finite OHLC/current-price fields, and the expected fingerprint;
- `tradingview.current_watchlist` returned between one and 64 schema-valid visible
  rows with canonical exchange-qualified symbols and finite quote fields;
- navigation to an unsupported TradingView path removed all TradingView tools while
  preserving the synthetic bridge-status tool; and
- the browser context closed and the temporary profile was deleted with retry-safe
  cleanup.

The field harness did not click, fill, or type into TradingView and did not use
Playwright as a pack runtime. Playwright only hosted the disposable Chromium
process; reads crossed the real MCP stdio, Rust bridge, Native Messaging, extension,
page-channel, and reviewed pack path.

Security limits:

- no cookies, tokens, headers, browser storage, request traffic, HAR data, or private
  endpoints were read or transported;
- no live prices, watchlist contents, screenshots, raw tool outputs, request logs,
  or browser profile were retained; and
- the pack exposed no generic browser, DOM, JavaScript, fetch, screenshot, or
  request-replay capability.

Action limitation:

- this final pass discovered but did not approve or execute
  `tradingview.change_symbol`;
- deterministic tests cover canonical-symbol validation, exact same-origin URL
  generation, one-attempt document state, live-document revalidation, manifest
  `ACTION` classification, and bridge-owned argument-bound one-time approvals; and
- complete live action evidence remains follow-up work and must use the trusted
  extension approval page rather than bypassing approval or clicking TradingView.

Known volatility:

- TradingView does not provide a versioned rendered-page contract;
- live quotes mutate continuously, so capability refreshes are filtered by the
  actual tool set instead of republishing on price-only changes; and
- this field pass is compatibility evidence, not a guarantee of future site
  behavior or authorization for background collection.
