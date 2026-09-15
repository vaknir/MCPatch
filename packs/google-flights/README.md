# Google Flights pack

This private, reviewed package implements MCPatch's first real website adapter. It
reads only bounded semantics already rendered on compatible English Google Flights
pages. It does not submit searches, open bookings, make network requests, inspect
cookies or storage, decode opaque URLs, or expose generic DOM access.

The package is split across three trust-preserving layers:

- `document-source.ts` collects a small allowlisted semantic snapshot using stable
  accessibility labels and roles, never obfuscated site classes;
- `extractor.ts` deterministically validates the
  `google-flights-rendered-en-v1` fingerprint and produces bounded typed results;
- `adapter.ts` exposes only the three declared pack capabilities and re-reads the
  current snapshot for each call.

The manifest's compiled fallback handlers intentionally return `TOOL_NOT_FOUND`.
Production calls must cross the reviewed page-capability channel; they must never
fall back to synthetic or service-worker-local data.

Fixtures under `tests/fixtures` are invented semantic data, not copied website
markup or live results. See
[`docs/architecture/google-flights-adapter.md`](../../docs/architecture/google-flights-adapter.md)
for the complete security and compatibility contract.
