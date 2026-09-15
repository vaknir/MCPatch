# Google Flights browser-network reconnaissance — 2026-09-15

## Scope

A one-time signed-out Chromium profile performed a synthetic LHR–CDG round-trip
search. The capture was local and temporary. Analysis emitted only request methods,
hostnames, paths, parameter names, payload sizes, content types, and
credential-presence booleans. Cookie values, generated parameter values, request
payloads, and flight results were not copied into the repository.

## Findings

Google Flights represents the submitted search in the `tfs` parameter of
`https://www.google.com/travel/flights/search`. The compact value is deterministic
for the reviewed fields: route, dates, round trip, one adult, economy, and
unrestricted airline. The results page subsequently calls the same-origin private
frontend RPC `FlightsFrontendService/GetShoppingResults`.

The shopping RPC carried browser cookies and generated frontend build/session
parameters. Those values are unsuitable for storage or bridge-side replay: they are
session-bound, change independently of MCPatch, and would move browser credentials
across the product's trust boundary. No Authorization header was present in the
signed-out observation, but cookies were present.

## Decision for the first adapter

`flights.search` generates the bounded search URL and navigates the current tab. The
browser and Google Flights then perform the private shopping request themselves in
the live same-origin session. MCPatch does not reproduce the RPC, read cookies, or
send authentication material through the page channel, bridge protocol, logs, or
MCP result.

This gives the tool a non-UI execution path while preserving the browser as the
credential holder. The URL encoding is isolated behind a golden fixture so a Google
compatibility change fails locally and can be versioned independently. Rendered
results remain untrusted and pass through the existing bounded semantic extractor.

The temporary HAR and browser profile are development artifacts, never fixtures.
They must remain untracked and be removed after local analysis.
