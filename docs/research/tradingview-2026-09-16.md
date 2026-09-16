# TradingView public-page reconnaissance — 2026-09-16

Issue: [#134](https://github.com/vaknir/MCPatch/issues/134)

This reconnaissance used a fresh temporary browser profile on TradingView's public
English chart page. It inspected rendered, user-visible page semantics and tested
one same-origin navigation from `NASDAQ:AAPL` to `NYSE:IBM`. It did not sign in,
alter an account, inspect cookies or browser storage, record request traffic, retain
a profile, or call a private endpoint. The price examples observed during research
are intentionally absent from this document.

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

Global symbol search is deferred. The observed website uses a separate TradingView
host for symbol search, while Manifest v1 denies external extension networking.
Guessing a listing exchange is not acceptable because tickers can exist on multiple
venues. An agent can use canonical identifiers returned by the current chart or
watchlist; broader discovery needs its own constrained network and output contract.

Watchlist mutation, alerts, and chart capture are also deferred. Each needs a
reviewed authenticated-site action or media-result contract and dedicated approval
semantics. They must not be implemented by exposing generic clicking, selectors,
JavaScript execution, screenshots, or request replay.

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
