# TradingView MCPatch pack

This reviewed bundled pack exposes seven capabilities on exact
`https://www.tradingview.com/chart/` pages:

- `tradingview.current_chart` reads one active chart's canonical symbol,
  interval, visible candle OHLC, current displayed price, change, currency, and
  volume;
- `tradingview.current_watchlist` reads at most 64 visible watchlist rows;
- `tradingview.search_symbols` resolves a bounded company or ticker query to at
  most ten canonical exchange-qualified candidates; and
- `tradingview.change_symbol` schedules same-origin navigation to one validated
  canonical `EXCHANGE:TICKER` symbol after an argument-bound approval;
- `tradingview.capture_chart` returns only the active reviewed chart canvases as
  one bounded WebP MCP image; and
- `tradingview.add_to_watchlist` and `tradingview.remove_from_watchlist` mutate
  one exact canonical symbol in the current custom watchlist after an
  argument-bound one-time approval.

The pack reads bounded semantic attributes and text already rendered by TradingView.
It does not use generated CSS class names, cookies, tokens, captured headers,
generic fetch, arbitrary JavaScript, whole-page dumps, or browser automation. Its
compiled service-worker handlers always fail closed. Symbol search alone performs
a credential-free GET to the exact reviewed first-party
`https://symbol-search.tradingview.com` origin after the user grants that optional
authority. The operation fixes the path and request shape, rejects redirects and
oversized responses, and returns selected typed fields rather than response data.

Watchlist actions use TradingView's same-origin authenticated session without
reading or returning its cookie. The agent cannot choose a URL, method, list ID,
header, or arbitrary request body. MCPatch reads the current custom-list identity,
issues at most one fixed append/remove request, then re-reads the same list and
returns only a closed confirmation. Existing desired state is a deterministic
no-op. Non-custom lists, changed identities, malformed or oversized responses,
failed authentication, and failed postconditions all fail closed.

The compatibility fingerprint is `tradingview-chart-semantic-en-v1`. Version 1
supports one visible English-language chart. Multi-chart layouts fail closed rather
than guessing which chart is active.
