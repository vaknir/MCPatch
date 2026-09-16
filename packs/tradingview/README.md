# TradingView MCPatch pack

This reviewed bundled pack exposes three capabilities on exact
`https://www.tradingview.com/chart/` pages:

- `tradingview.current_chart` reads one active chart's canonical symbol,
  interval, visible candle OHLC, current displayed price, change, currency, and
  volume;
- `tradingview.current_watchlist` reads at most 64 visible watchlist rows;
- `tradingview.change_symbol` schedules same-origin navigation to one validated
  canonical `EXCHANGE:TICKER` symbol after an argument-bound approval.

The pack reads bounded semantic attributes and text already rendered by TradingView.
It does not use generated CSS class names, cookies, tokens, captured headers, generic
fetch, arbitrary JavaScript, whole-page dumps, or browser automation. Its compiled
service-worker handlers always fail closed.

Global symbol search is intentionally excluded. TradingView currently serves that
operation from a separate host, while MCPatch Manifest v1 denies extension external
networking. Agents should pass canonical symbols such as `NASDAQ:AAPL`, `NYSE:IBM`,
or `BINANCE:BTCUSDT`; the current watchlist tool returns canonical identifiers.

The compatibility fingerprint is `tradingview-chart-semantic-en-v1`. Version 1
supports one visible English-language chart. Multi-chart layouts fail closed rather
than guessing which chart is active.
