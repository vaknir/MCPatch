# Google Flights MCP field report — 2026-09-15

Status: **passed locally**

Environment:

- Chromium: 153.0.8010.12
- locale: `en`
- profile: fresh, temporary, and signed out
- compatibility fingerprint: `google-flights-rendered-en-v1`

Typed tools verified through MCP:

- `flights.search`
- `flights.current_search`
- `flights.results`
- `flights.price_insights`

Evidence:

- the MCP client discovered the search tool on the compatible landing page;
- the bridge required a one-time approval bound to the exact tool, Google origin,
  argument hash, expiry, and single use;
- the typed search call generated one same-origin URL and navigated the current tab;
- the test did not click, fill, or type into the Google Flights form;
- Google loaded live results using the browser session, after which all three typed
  read tools returned schema-valid bounded results through the real bridge and
  extension path;
- navigation to an unsupported Google path removed the pack tools; and
- disabling the pack revoked its content-script registration and MCP capabilities.

Security limits:

- no cookies, tokens, headers, browser storage, raw RPC payloads, or HAR data crossed
  the extension/bridge boundary;
- no result values, prices, screenshots, request logs, or browser profile were
  retained;
- the generated URL contains only validated airport/date search state and fixed
  product options; and
- the pack exposes no generic browser, DOM, JavaScript, fetch, or request-replay tool.

Known volatility:

- Google Flights does not provide a versioned DOM or search-state encoding contract;
- a compatibility change must fail closed, update deterministic fixtures, and receive
  a reviewed pack patch release plus a fresh field report; and
- this one-time field pass is compatibility evidence, not a guarantee of future site
  behavior or authorization for repeated scraping.
