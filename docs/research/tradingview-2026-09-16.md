# TradingView public-page reconnaissance — 2026-09-16

Issue: [#134](https://github.com/vaknir/MCPatch/issues/134)

This reconnaissance used a fresh temporary browser profile on TradingView's public
English chart page. It inspected rendered, user-visible page semantics and tested
one same-origin navigation from `NASDAQ:AAPL` to `NYSE:IBM`. It did not sign in,
alter an account, inspect cookies or browser storage, retain a profile, or call a
private endpoint. A later #137 pass observed only the public first-party symbol
search request shape and response schema; it retained no response values or HAR.
The price and search examples observed during research are intentionally absent from
this document.

## Findings

TradingView did not expose a native `document.modelContext` tool on the observed
chart page. The page exposed enough semantic state for three narrow capabilities:

- the chart is a labelled region and has labelled symbol and interval controls;
- the listing exchange is visible through a descriptive title;
- the accessible chart-canvas label includes a provider-qualified ticker;
- visible OHLC, change, volume, and currency values are available in the chart
  region; and
- visible watchlist rows expose canonical and short symbols, active state, quote
  values, and optional market status through stable semantic attributes.

The document title begins with the ticker. For the observed NASDAQ listing, the
canvas provider was `BATS`; therefore the adapter validates ticker agreement but
does not treat the canvas provider as the listing exchange.

Loading `/chart/?symbol=NYSE%3AIBM` selected IBM and produced mutually consistent
title, exchange, chart, and watchlist state without any form filling or click
automation. This supports a deterministic same-origin `change_symbol` action based
on a canonical identifier.

## Product decision

The first TradingView pack exposes `tradingview.current_chart`,
`tradingview.current_watchlist`, and `tradingview.change_symbol`. It does not use
Playwright or browser automation at runtime. MCP calls reach reviewed page handlers
through the existing extension and bridge route; the page handlers read only their
bounded declared semantics or schedule the exact approved navigation.

Follow-up issue #137 inspected the separate public TradingView symbol-search host
from the same disposable signed-out profile. Its GET response is available to the
TradingView page origin without cookies, tokens, or captured headers. MCPatch now
uses a separately reviewed exact-origin grant and a fixed request shape to return at
most ten typed canonical candidates. Guessing a listing exchange remains
unacceptable because tickers can exist on multiple venues; the agent never receives
the raw response or a generic request capability.

Follow-up issues #138 and #139 added a bounded chart-image contract and exact
current-watchlist mutations. The watchlist review identified TradingView's
same-origin active-list read plus custom-list `append` and `remove` operations.
MCPatch fixes those paths and request shapes in reviewed code, derives the list ID
from the authenticated response, performs no retry, and verifies the final state.
Cookies remain in the browser and no generic request capability is exposed.

Alert creation remains deferred pending its own reviewed authenticated-site action
contract. None of these capabilities may be implemented by exposing generic
clicking, selectors, JavaScript execution, screenshots, or request replay.

## Volatility and verification

TradingView does not provide a versioned rendered-page contract. The pack therefore
uses the compatibility fingerprint `tradingview-chart-semantic-en-v1`, admits one
English chart, validates multiple independent symbol signals, and fails closed on
ambiguity. Invented semantic fixtures cover compatible and incompatible states. A
later same-day signed-out MCP smoke validated live chart and watchlist reads through
the bridge and extension; its bounded evidence is recorded in the
[field report](../test-reports/2026-09-16-tradingview-field.md). That pass is evidence
for one date and browser version, not a durability guarantee. Site changes require
a reviewed adapter update and fresh fixtures.
