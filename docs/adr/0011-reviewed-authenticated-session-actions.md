# ADR 0011: Permit reviewed authenticated same-origin actions

- Status: Accepted
- Date: 2026-09-16
- Issue: [#139](https://github.com/vaknir/MCPatch/issues/139)

## Context

Useful website actions sometimes have a narrow first-party operation that is safer
and more deterministic than controlling rendered UI. TradingView's current custom
watchlist supports same-origin append and remove operations authorized by the
browser's existing session. Exporting session material, exposing generic fetch, or
letting the agent supply a list identifier would violate MCPatch's boundary.

## Decision

A reviewed bundled pack may perform an authenticated same-origin request for an
`ACTION` tool when all authority remains inside compiled pack code. This is not a
new manifest permission class: the exact site origin is already the enabled pack
origin, and every call still requires the bridge's argument-bound one-time
approval.

The TradingView watchlist operations:

- accept only one canonical `EXCHANGE:TICKER` value;
- read the active list from one fixed same-origin path and require a numeric ID,
  a bounded name, type `custom`, and at most 1,024 validated symbols;
- derive the append/remove path from that server-provided ID;
- send exactly one JSON array containing the approved symbol;
- never return the ID, cookie, response body, headers, or unrelated list data;
- issue no mutation when the requested state already holds;
- do not retry a mutation;
- re-read the active list and require the same identity and exact postcondition;
  and
- bound each response to 256 KiB and the complete operation to eight seconds.

The agent cannot provide a URL, method, header, credentials mode, request body,
list ID, or retry policy. Redirects, authentication failures, non-custom lists,
malformed responses, list changes, and uncertain outcomes fail closed.

## Consequences

- Watchlist updates feel like typed MCP actions rather than browser automation.
- Browser cookies remain HttpOnly and never cross the content-runtime boundary.
- Approval binds tool, origin, exact symbol argument, expiry, and one use before
  any browser-session request is dispatched.
- Dynamic community code does not inherit this authority merely by declaring an
  action; executable reviewed packs remain a separate trust tier.
- A real mutation smoke is opt-in and must use a disposable account and symbol.

## Alternatives considered

### Click the watchlist UI

Rejected. It is visually brittle, stateful, slower, and introduces no useful
security boundary once a narrower first-party contract is known.

### Let the agent select a list ID or endpoint

Rejected. It widens a single current-list capability into account-level request
authority.

### Replace the complete watchlist

Rejected. A stale snapshot could silently delete unrelated symbols.

### Capture and replay HAR traffic

Rejected for runtime use. Research artifacts can reveal a contract, but recorded
headers, tokens, cookies, and arbitrary replay are not product capabilities.
