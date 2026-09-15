# Google Flights public-page reconnaissance — 2026-09-15

Issue: [#114](https://github.com/vaknir/MCPatch/issues/114)

This reconnaissance used a fresh signed-out browser page and one invented
London-to-Paris round-trip search. It inspected rendered, user-visible page
semantics only. It did not inspect or retain cookies, browser storage, request
payloads, private endpoints, account data, booking flows, or price-tracking state.
Observed prices and opaque search parameters are intentionally absent from this
document.

## Findings

Google Flights did not expose a native `document.modelContext` tool on either the
landing page or the populated search-results document.

The signed-out English results page exposed enough rendered semantic state for a
small read-only adapter:

- the canonical origin was `https://www.google.com` and the results path was
  `/travel/flights/search`;
- current origin, destination, departure, and return values were visible through
  labelled controls;
- the document exposed explicit loading text followed by a bounded result count;
- each rendered flight choice had a native or ARIA link with a complete accessible
  summary covering displayed price, trip-price scope, stops, carrier, departure,
  arrival, and duration;
- optional rendered descendants exposed emissions and baggage caveats; and
- a `Price insights` section exposed a short visible assessment when available.

The result page changed in place after asynchronous loading. It also contained
duplicate responsive/search structures, so extraction cannot assume the first DOM
match is authoritative. Visibility and semantic uniqueness must be checked.
Obfuscated class names and opaque application attributes were present but are not a
supported interface and were not recorded.

## Product decision

The first adapter supports only the documented English rendered-page fingerprint.
It reads display values as display values; it does not decode Google's opaque URL
state or infer normalized dates, airports, currencies, or fares from hidden data.
Unknown locale, route type, ambiguous controls, or incompatible result grammar
fails closed by publishing no Google Flights pack capability.

The first tools are:

- `flights.current_search` — bounded visible form state;
- `flights.results` — bounded current rendered result summaries; and
- `flights.price_insights` — the current short visible price assessment.

All three are `READ`, have no extension network permission, and treat every string
as untrusted website content. Booking, selecting a flight, tracking prices, changing
filters, or submitting a search is outside the pack.

## Volatility and verification

Google Flights is not providing a versioned DOM contract. The adapter therefore
has its own compatibility fingerprint, `google-flights-rendered-en-v1`, and must be
covered by scrubbed fixtures. A field smoke is evidence for one date and browser
version, not a durability guarantee. Site changes require a reviewed adapter update
and fresh fixture and field reports; runtime code must not silently broaden its
selectors to compensate.

The later search-action network observation and credential-boundary decision are
documented separately in
[Google Flights browser-network reconnaissance](google-flights-network-2026-09-15.md).
