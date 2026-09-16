# ADR 0012: Permit reviewed external session actions

- Status: Accepted
- Date: 2026-09-16
- Issue: [#140](https://github.com/vaknir/MCPatch/issues/140)

## Context

TradingView creates price alerts through the first-party
`https://pricealerts.tradingview.com` service rather than the chart page origin.
The request uses the browser's authenticated session. Treating this as an ordinary
read would bypass approval; rejecting all external writes would force brittle UI
control. A generic authenticated network tool would be an unacceptable credential
and account-action proxy.

## Decision

Pack Manifest v1 network authority admits a canonical subset of `GET` and `POST`.
The validator requires `GET` to pair with at least one `READ + EXTERNAL_NETWORK`
tool and `POST` with at least one `ACTION + EXTERNAL_NETWORK` tool. The bridge
allows only these two exact reviewed-pack forms: reads are automatic and actions
require its existing argument-bound, expiring, one-use approval. Native WebMCP,
sensitive, credential, arbitrary-execution, mixed, and malformed combinations are
denied.

The TradingView alert tool accepts only:

- the condition `above`, `below`, or `crosses`;
- one finite threshold bounded to magnitude 10^12;
- frequency `once` or `once_per_bar_close`;
- expiry from one to 365 days; and
- popup, mobile-push, or both as a closed notification choice.

Reviewed code derives the canonical symbol and interval from the compatible active
chart, builds one fixed `/create_alert` payload, disables email, SMS, sound,
webhooks, arbitrary messages, and scripts, and sends at most one POST. No caller
controls the destination, method, headers, symbol, resolution, or raw body.

The create response must contain a bounded alert ID. A separate bounded
`/list_alerts` read checks that ID and exact symbol. Confirmation failure after an
accepted ID returns `created_unconfirmed`, not a retryable error, and the document
lifecycle permits only one creation attempt. This avoids duplicate alerts after an
uncertain read. Redirects, rejected creation, malformed or oversized responses,
invalid chart identity, cancellation before dispatch, and unsupported inputs fail
closed.

## Consequences

- Price alerts are normal typed MCP actions without browser automation.
- The browser session authorizes the first-party service but no cookie or token is
  read, returned, logged, or sent through MCPatch's bridge.
- Enabling TradingView visibly grants the exact chart, symbol-search, and
  price-alert host patterns together.
- Host permission is broader than one path at the browser API level; reviewed
  compiled code and absence of a generic request primitive remain required parts
  of the boundary.
- A real creation smoke requires a disposable signed-in account and manual cleanup
  by alert ID. It never runs in routine CI.

## Alternatives considered

### Automate the Create Alert dialog

Rejected. UI state and selectors are unnecessary when a narrower typed operation
is available.

### Allow arbitrary messages or webhook URLs

Rejected. They add data-exfiltration and external side-effect channels unrelated
to a basic price alert.

### Retry when confirmation fails

Rejected. Creation is not idempotent and a blind retry can duplicate an alert.

### Export the browser session to the bridge

Rejected. Authentication must remain inside the browser trust boundary.
