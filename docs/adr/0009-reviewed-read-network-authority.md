# ADR 0009: Permit bounded reviewed read-network authority

- Status: Accepted
- Date: 2026-09-16
- Issue: [#137](https://github.com/vaknir/MCPatch/issues/137)

## Context

Some useful site capabilities need a first-party service on a different exact
origin. TradingView's public symbol search is served from
`https://symbol-search.tradingview.com` and explicitly permits GET requests from
`https://www.tradingview.com`. Refusing every such request would force agents to
guess exchanges or push packs toward brittle UI control. A generic fetch tool or
ambient wildcard authority would violate MCPatch's capability boundary.

## Decision

Pack Manifest v1 accepts either `extensionRequests: "none"` or a closed policy of
one to eight canonical HTTPS origins and exactly the `GET` method. A network policy
and an `EXTERNAL_NETWORK` tool permission must occur together.

The extension includes each reviewed origin in `optional_host_permissions`. One
user gesture requests the matched page origin and every pack network origin as one
atomic grant. Activation and restart reconciliation require the complete set;
permission removal revokes page authority before cleanup. External origins never
become content-script match patterns.

The bridge permits `READ + EXTERNAL_NETWORK` only for an authenticated pack
capability carrying an immutable pack reference. All native, action, sensitive,
credential, arbitrary-execution, mixed, or malformed variants remain denied.

ADR 0012 later admits the separate `ACTION + EXTERNAL_NETWORK` form only with
declared POST authority and bridge-owned one-time approval. The credential-free
read contract in this decision remains unchanged.

Each compiled operation must additionally:

- construct one fixed HTTPS host and operation path itself;
- accept no caller URL, method, headers, body, or credentials;
- use `credentials: "omit"` and reject redirects;
- bound input, duration, response bytes, source records, and projected results;
- parse selected fields into a closed typed result; and
- fail without returning transport bodies or diagnostics.

The TradingView operation is fixed to `/symbol_search/v3/`, sends no cookie or
token, caps the response at 256 KiB and 64 source records, and returns at most ten
deduplicated `EXCHANGE:TICKER` candidates.

## Consequences

- Symbol discovery remains a normal typed MCP read instead of browser automation.
- Enabling the pack visibly grants two exact TradingView origins.
- Pack review still matters because bundled content code runs in the page context;
  the manifest is an auditable authority declaration, not a JavaScript sandbox.
- Dynamic community packs cannot inherit this execution tier until the runtime can
  enforce an equally narrow declarative operation vocabulary.

## Alternatives considered

### Return ambiguous tickers

Rejected. The agent could select the wrong exchange or instrument.

### Automate the symbol-search dialog

Rejected. It is slower, stateful, visually brittle, and unnecessary for a
first-party read contract.

### Expose generic fetch or captured browser traffic

Rejected. It would let an agent select destinations or replay authenticated
material and would turn the extension into a network proxy.

### Send browser credentials

Rejected. The endpoint works in a signed-out disposable profile and requires no
cookies, tokens, or captured headers.
