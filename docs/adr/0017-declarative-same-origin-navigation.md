# ADR 0017: Permit typed declarative same-origin navigation

- Status: Accepted
- Date: 2026-09-17
- Issue: [#153](https://github.com/vaknir/MCPatch/issues/153)
- Extends: [ADR 0005](0005-pack-execution.md), [ADR 0006](0006-permission-and-approval-model.md)

## Context

Community packs can safely read bounded visible state, but useful website tools
also need route changes such as opening a chart symbol or a search result. Generic
clicks, selectors, forms, arbitrary URLs, or downloaded JavaScript would turn the
pack format into browser automation and widen the authenticated browser boundary.

## Decision

Declarative Operations v2 adds only `navigate` with an independently fixed
`navigationVersion: 1`. The signed operation owns the authorized origin, static
path shape, and static unique query keys. Required, bounded string arguments can
fill one declared component each and are encoded as data. They cannot affect URL
authority or structure. The runtime exposes no DOM mutation, request, credential,
redirect, or script primitive.

Every navigation is an `ACTION` and therefore requires the bridge's existing
argument-bound, one-time approval. After approval, the page runtime validates the
exact live document and signed bundle again, returns a scheduled acknowledgement,
then revokes that document before one deferred `location.assign`. Cancellation
before the deferred attempt has no effect. A destination is never assumed to be
available; only its fresh page handshake can publish tools.

Operations v1 remains accepted unchanged for read-only packs. The bundle and
manifest formats remain version 1 because their envelopes already version the
operations language independently.

## Consequences

- Community authors can express common route changes without code or UI clicks.
- The agent still cannot choose an origin, raw URL, HTTP request, selector, or
  browser primitive.
- Tool success means scheduled, not loaded or completed.
- Regex schema constraints remain outside the runtime allowlist; bounded strings
  and finite enums avoid a cross-runtime regex execution surface.
- Future mutations, forms, requests, or richer navigation require separate
  operation versions and security review.
