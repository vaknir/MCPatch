# ADR 0015: Configure a reviewed pack's origin at runtime

- Status: Accepted
- Date: 2026-09-17
- Issue: [#1](https://github.com/vaknir/MCPatch/issues/1)

## Context

Reviewed bundled packs have so far targeted public sites whose origin is a
reviewable constant: `https://www.google.com`, `https://www.tradingview.com`.
Self-hosted products break that assumption. A Jira Data Center deployment lives
at an origin only its users know, so no compile-time list can name it, and a
per-customer rebuild of the extension is not a product.

[ADR 0014](0014-registry-discovery-and-origin-authority.md) already decided how
arbitrary HTTPS origins become authority — declare the narrowest platform
pattern, request only the exact selected origin at a user gesture, prove that
exact grant afterwards — but scoped it to dynamically installed community packs
interpreted by the declarative runtime. Reviewed compiled packs kept their
static origin lists.

## Decision

A reviewed bundled pack may declare a **configurable origin**: its manifest
carries one synthetic `.invalid` origin as a marker, and the real origin comes
from user configuration at runtime. The extension applies ADR 0014's origin
authority rules to it unchanged.

### Configuration is a request, never authority

`chrome.storage.local["mcpatch.origins.v1"]` stores at most eight closed
records of `{publisher, id, origin}`. Storage access is restricted to
`TRUSTED_CONTEXTS`. Origins must be canonical HTTPS with no wildcard, no
credentials, no path, and no `.invalid` suffix; malformed, duplicated,
accessor-backed, or oversized state is discarded rather than repaired.

A stored origin says only which site a configurable pack should be _offered_
on. The catalog substitutes it for the pack's placeholder, binding the reviewed
manifest identity and its path rules to that origin. The manifest keeps its
reviewed digest; the enablement record already stores origin separately from
digest, so a configured site is identified by both. Nothing is enabled until
the browser grant and the registered script agree, exactly as before.

A pack whose placeholder has no configuration contributes no site, matches no
page, and cannot be enabled. The placeholder origin itself is never requested,
never granted, and never matched against a real page.

### Host authority

The Chromium build declares `https://*/*` under `optional_host_permissions` as
the narrowest platform pattern that can express a runtime-selected HTTPS host.
This declaration is not a grant and is never requested. Enablement requests only
`https://configured-host[:port]/*` for the pack the user clicked, in the
synchronous user-gesture turn, as it already did for static origins.

### Proof changes shape

`permissions.contains` was sufficient while every declared optional origin was
exact. It is not sufficient now: a broader granted pattern satisfies an
exact-looking query, so a site could appear authorized on the strength of
authority the user never granted for it. Reconciliation therefore reads the
complete `permissions.getAll()` origin inventory, requires each of a site's
exact patterns within it, and refuses a covering grant — `<all_urls>`,
`*://*/*`, `https://*/*`, or a wildcard subdomain covering the host — as proof.

This is a strengthening for every pack, not only configurable ones, and it is
the reason the broad declaration can be added safely.

MCPatch does not reduce or remove a covering grant on the user's behalf; it
fails closed and leaves the pack disabled. ADR 0014 permits removing a managed
covering grant and reconciling again; that remains available if a real case
appears, but refusing proof is the smaller behavior and is what is implemented.

### What does not change

Pack Manifest v1 still accepts exact origins only. Compiled pack code, tool
contracts, approvals, native WebMCP precedence, the one shared content-script
registration per origin, and the fail-closed lifecycle are untouched. A
configurable pack gets no new permission class: Jira Data Center declares
`networkPolicy.extensionRequests: "none"` and every call is same-origin under a
fixed REST root.

## Consequences

- Self-hosted products are reachable without a per-customer extension build.
- The broad optional declaration exists in the shipped manifest, so the exact
  pattern reviewers see in `optional_host_permissions` is wider than any
  authority MCPatch ever holds. Proof, not declaration, is the boundary.
- `permissions.contains` is removed from the extension's Chromium surface so a
  future caller cannot reintroduce the weaker check.
- Chrome Web Store review becomes a release gate for the whole extension rather
  than only for dynamic community packs: ADR 0014's issue #165 must obtain
  written evidence that `https://*/*` is acceptable for this single purpose and
  user flow. If the Store rejects it, configurable-origin packs move to a
  host-limited or self-built channel; the security boundary does not weaken to
  satisfy distribution.
- There is still no configuration UI. Origins are written to extension storage
  directly, which suits a self-built or enterprise-deployed extension and is
  not yet a shippable consumer flow.

## Alternatives considered

### Keep a compile-time origin list per deployment

Rejected as the product answer. It works, and it is what the first Jira pack
did, but it makes every customer rebuild and re-review an extension to use a
pack that is already reviewed.

### Put the origin in the pack manifest at install time

Rejected. It would make the manifest — and therefore the digest that identifies
reviewed content — vary per user, so two installs of the same reviewed pack
would no longer be comparable.

### Request `https://*/*` and filter matches in the extension

Rejected, as in ADR 0014. A broad runtime grant is real ambient authority no
matter how narrowly the extension then behaves, and it destroys exact-origin
consent.

### Derive the origin from the current tab without configuration

Rejected. The toolbar gesture already supplies the current tab, but treating any
visited host as a Jira deployment would let any page that mimics Jira's `ajs-*`
metadata solicit an enablement prompt. Configuration is a deliberate,
inspectable act separate from browsing.

## References

- [ADR 0006: permissions and approvals](0006-permission-and-approval-model.md)
- [ADR 0011: reviewed authenticated session actions](0011-reviewed-authenticated-session-actions.md)
- [ADR 0014: registry discovery and origin authority](0014-registry-discovery-and-origin-authority.md)
- [Pack enablement reconciliation](../architecture/pack-enablement.md)
- [Jira Data Center session adapter](../architecture/jira-adapter.md)
