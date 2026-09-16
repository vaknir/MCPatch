# ADR 0015: Classify rendered-content reads as READ, not SENSITIVE

- Status: Accepted
- Date: 2026-09-16
- Issue: [#185](https://github.com/vaknir/MCPatch/issues/185)
- Amends: [ADR 0006](0006-permission-and-approval-model.md)

## Context

ADR 0006 states that `READ` does not mean harmless and that a tool which reads
private or high-impact content must also declare `SENSITIVE`, which requires an
argument-bound one-time approval per call. It does not define "private".

Two facts made that gap visible:

- `tradingview.current_watchlist` shipped as a plain `READ` tool. It reads the
  user's own watchlist, which is account-bound, from the rows currently rendered
  in the document.
- The bundled-pack permission ceiling in `apps/extension/src/bundled-packs.ts` is
  `["READ", "ACTION", "EXTERNAL_NETWORK"]`. No bundled pack can declare
  `SENSITIVE`, so the per-call approval path for sensitive reads has never been
  exercised by a real pack.

Either the watchlist read violated ADR 0006 or ADR 0006 needed a rule. Deciding by
omission would leave every future pack reviewer to re-argue the line.

## Decision

A tool is `SENSITIVE` when it can expose data the user has **not already chosen
to display in the current document**, or data that is high-impact regardless of
display. Concretely:

1. **Rendered content is `READ`.** A tool that reads only content rendered in the
   current top-level document, through a closed output schema, is `READ` even
   when that content is account-bound. The user opened the page and can see the
   same rows; the tool changes who can read them, not what is visible.
2. **Credential-free network reads are `READ`.** A `READ + EXTERNAL_NETWORK` tool
   is `READ` only when its request carries no cookies, tokens, or captured
   headers (`credentials: "omit"`, as ADR 0009 requires) and returns data a
   signed-out visitor could obtain. It therefore cannot reach account data at
   all. Any request that carries session material is not a read under this
   rule; it is `SENSITIVE` or `ACTION` per ADR 0011 and ADR 0012.
3. **Undisplayed account data is `SENSITIVE`.** A tool that reaches data the user
   has not rendered — another page, a collapsed panel, an API response the page
   would not show a signed-out visitor — is `SENSITIVE` even if the transport is
   a same-origin read.
4. **High-impact content is `SENSITIVE` even when rendered.** Credentials,
   secrets, payment instruments, government or account identifiers, and private
   correspondence stay `SENSITIVE` when the page displays them. Rendering does
   not make a password field harmless.
5. **Media inherits its scope.** An image result is classified by the content its
   reviewed capture scope can contain, under the same four rules.

The bundled permission ceiling is unchanged. `SENSITIVE` is added to it only when
a pack needs it, and that change must land with a Chromium fixture proving the
per-call approval path end to end.

### Worked examples

| Tool                                            | Class                     | Rule     |
| ----------------------------------------------- | ------------------------- | -------- |
| `flights.results`                               | `READ`                    | 1        |
| `tradingview.current_chart`                     | `READ`                    | 1        |
| `tradingview.current_watchlist`                 | `READ`                    | 1        |
| `tradingview.capture_chart`                     | `READ`                    | 5        |
| `tradingview.search_symbols`                    | `READ + EXTERNAL_NETWORK` | 2        |
| `tradingview.add_to_watchlist`                  | `ACTION`                  | ADR 0011 |
| reading a balance from an unopened account page | `SENSITIVE`               | 3        |
| reading rendered private messages               | `SENSITIVE`               | 4        |
| any tool that could return a token              | `CREDENTIAL` (denied)     | ADR 0006 |

## Consequences

- The shipped TradingView and Google Flights reads are compliant by rule, not by
  omission, and reviewers apply the same five rules to every future pack.
- The pack review checklist in `CONTRIBUTING.md` gains an explicit classification
  step.
- The enforcement-status table (#189) records this row as review-enforced: the
  runtime cannot tell rendered content from undisplayed content, so the rule is
  applied by the reviewer and pinned by fixtures.
- Adding `SENSITIVE` to the bundled ceiling later is a deliberate change with its
  own fixture, never a side effect of a pack landing.

## Alternatives considered

### Widen the ceiling and reclassify the watchlist read as `SENSITIVE`

Rejected for now. It is the more conservative reading of ADR 0006, but it
requires a prompt for every watchlist read of rows the user is already looking
at, which trains users to approve reflexively and weakens the prompts that
matter. Rule 4 keeps the conservative outcome for the content that warrants it.

### Session-scoped grants for sensitive reads

Deferred. A scoped grant needs a new manifest and protocol version and its own
threat analysis; it is listed as a Phase 14.5 non-goal.

### Leave the line to each review

Rejected. Unwritten rules drift, and the Phase 13 community review gate needs a
rule it can cite.

## References

- [ADR 0006: Enforce deny-by-default permissions and bound approvals](0006-permission-and-approval-model.md)
- [ADR 0009: Permit bounded reviewed read-network authority](0009-reviewed-read-network-authority.md)
- [ADR 0011](0011-reviewed-authenticated-session-actions.md) and
  [ADR 0012](0012-reviewed-external-session-actions.md) for session-bearing actions
