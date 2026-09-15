# Google Flights pack

This private, reviewed package implements MCPatch's first real website adapter. It
reads bounded semantics already rendered on compatible English Google Flights pages
and can open one approved, exact-airport round-trip search. It does not open
bookings, replay captured requests, inspect cookies or storage, or expose generic DOM
or browser access.

The package is split across four trust-preserving layers:

- `document-source.ts` collects a small allowlisted semantic snapshot using stable
  accessibility labels and roles, never obfuscated site classes;
- `extractor.ts` deterministically validates the
  `google-flights-rendered-en-v1` fingerprint and produces bounded typed results;
- `search-input.ts` validates the closed airport/date request;
- `search-navigation.ts` encodes only those values into Google Flights' bounded
  same-origin search URL and schedules navigation after acknowledgement; and
- `adapter.ts` exposes only the four declared pack capabilities and revalidates the
  current page before each call.

`flights.search` is an `ACTION` and therefore cannot reach the page until the Rust
bridge creates an argument-bound one-time approval and the user approves it in the
extension-owned prompt. It accepts only distinct three-letter uppercase airport
codes and two valid future ISO dates within 330 days. The fixed action is one adult,
economy, round trip. Google Flights performs its own shopping request using the
tab's live browser session; MCPatch never reads or transports that session. The
action cannot select an itinerary, book, sign in, or track prices.

The manifest's compiled fallback handlers intentionally return `TOOL_NOT_FOUND`.
Production calls must cross the reviewed page-capability channel; they must never
fall back to synthetic or service-worker-local data.

Fixtures under `tests/fixtures` are invented semantic data, not copied website
markup or live results. See
[`docs/architecture/google-flights-adapter.md`](../../docs/architecture/google-flights-adapter.md)
for the complete security and compatibility contract.
