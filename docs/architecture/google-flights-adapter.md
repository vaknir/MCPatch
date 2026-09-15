# Google Flights rendered-page adapter

The first real MCPatch pack is a reviewed, bundled, read-only adapter for current
Google Flights page state. It implements the reconnaissance in
[Google Flights public-page reconnaissance](../research/google-flights-2026-09-15.md)
without turning the content runtime into a generic DOM interface.

## Authority and activation

Version 1 accepts only the canonical origin `https://www.google.com` and exact
paths `/travel/flights` or `/travel/flights/search`. The browser permission remains
the exact optional pattern `https://www.google.com/*`; path restrictions are
rechecked inside MCPatch. Booking and all other Google paths publish no pack tools.

The adapter is compiled into the reviewed extension artifact. A static catalog maps
the validated pack identity to its constructor. A page cannot name an adapter,
provide code, change its manifest, or add a tool. There is no downloaded script,
main-world injection, page-provided selector, generic DOM command, or
extension-originated request.

The reviewed implementation lives in `packs/google-flights`. Its document source
collects a minimal semantic snapshot, its pure extractor validates the fingerprint,
and its page adapter re-reads current state per call. The compiled manifest handlers
fail closed with `TOOL_NOT_FOUND`; production results must come from the authorized
page-capability route.

Native WebMCP discovery runs alongside the pack adapter. The existing resolver
prefers one eligible native tool with the same name. If Google later publishes a
valid native capability, MCPatch does not invoke the fallback pack for that name.

## Compatibility fingerprint

The initial fingerprint is `google-flights-rendered-en-v1`. Admission requires:

- an English document language;
- one visible, semantically labelled origin control and destination control;
- supported visible trip type (`Round trip` or `One way`) and cabin-class values;
- no ambiguous duplicate among the selected visible controls; and
- on `/travel/flights/search`, the known flight-search and search-results semantic
  regions plus one recognized transitional or terminal result state.

The adapter may tolerate missing optional return date, emissions, baggage caveat,
or price insight. It must not tolerate an unknown language, `Multi-city`, missing
required search controls, multiple visible candidates for one required field,
unrecognized result-card grammar, or contradictory loading/terminal states.
Compatibility failure publishes no pack capability and records only the local
fingerprint/error code, never page text.

Obfuscated CSS classes, `jsname`, `data-ved`, hidden application state, opaque URL
parameters, and network responses are explicitly outside the fingerprint.

## Tool contracts

Every input is the closed empty object. Output strings are copied from visible page
semantics, normalized only for whitespace, bounded in length, and remain untrusted.
The adapter never returns markup, selectors, node identifiers, URLs, opaque query
state, or raw page dumps.

### `flights.current_search`

Returns fingerprint version, path kind, trip type, cabin class, passenger display,
origin display, destination display, departure display, and optional return display.
Display dates are not represented as ISO dates because the normal closed form omits
the year and normalizing from opaque URL state would create a hidden dependency.

### `flights.results`

Returns a state of `loading`, `ready`, `empty`, or `error`. A ready result contains
the visible reported result count and at most 20 currently rendered flight choices.
Each choice has a one-based rank and bounded display strings for summary, price,
price scope, stops, carrier, departure, arrival, duration, optional emissions, and
at most four caveats. A card that does not match the complete English v1 grammar is
excluded; if result state says ready but no card can be safely interpreted, the
adapter fails compatibility rather than returning partial guesses.

### `flights.price_insights`

Returns `loading`, `available`, or `unavailable` plus the fingerprint version. The
available state contains only the bounded short assessment rendered under the price
insight region. It does not open price history, infer a recommendation, or return a
chart.

## Resource and lifecycle bounds

Discovery considers at most 64 semantic candidates and emits no more than three
capabilities. Tool execution visits at most 64 result candidates, returns at most 20
choices, accepts at most four caveats per choice, and enforces the existing page JSON
depth, node-count, and 256 KiB frame bounds. It checks the call `AbortSignal` while
iterating and before returning.

A document-local mutation observer watches rendered structure, coalesces changes for
250 milliseconds, and recomputes a small non-content signature. It requests a new
snapshot only when search/result state changes; it does not continuously serialize
the page. Navigation, permission removal, pack disable, malformed channel traffic,
adapter incompatibility, or bridge disconnect revokes the context and aborts calls
through the existing page lifecycle.

## Fixture and field policy

Deterministic tests use invented airports, carriers, times, prices, insight text, and
locale variants. Fixtures describe only the minimal semantic adapter input and may
not contain copied Google markup, live prices, opaque query values, or personal data.
Tests cover loading, ready, empty, error, unsupported locale/layout, duplicate and
hidden controls, malformed cards, output limits, mutation coalescing, and
cancellation.

After fixtures pass, one fresh signed-out Chromium profile may run a neutral public
search. The field report records only date, browser version, locale, tool names,
fingerprint, pass/fail state, and limitations. It must not retain the browser profile,
cookies, raw result output, screenshots containing live results, or request logs.

## Explicit non-goals

- searching for flights or changing page state;
- selecting or booking a flight;
- tracking prices or signing in;
- reading cookies, credentials, browser storage, or hidden page state;
- calling or reverse-engineering private Google endpoints; and
- background, repeated, or scaled scraping.

## Related decisions

- [ADR 0005: pack execution](../adr/0005-pack-execution.md)
- [ADR 0008: origin-scoped content runtime](../adr/0008-origin-scoped-content-runtime.md)
- [Pack resolution and native precedence](pack-resolution.md)
- [Extension page-channel protocol](page-channel-protocol.md)
