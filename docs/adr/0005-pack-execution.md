# ADR 0005: Prefer declarative packs and prohibit runtime-downloaded code

- Status: Accepted
- Date: 2026-09-15
- Issue: [#7](https://github.com/vaknir/MCPatch/issues/7)

## Context

Packs adapt websites that do not expose native WebMCP tools. They run near an
authenticated page, so a malicious or compromised pack can read private content or
act as the user. A conventional package marketplace that downloads JavaScript and
evaluates it in the extension would make publisher reputation the primary security
boundary and conflict with Chromium Manifest V3 remote-code restrictions.

Some integrations need site-specific logic, but many read-only tools can be
described as bounded extraction and interaction operations interpreted by a fixed
runtime.

## Decision

Use two pack implementation tiers:

1. **Declarative packs** are data validated against pack manifest version `1` and
   interpreted by a fixed, reviewed runtime. These are the only packs eligible for
   independent registry delivery in the initial product direction.
2. **Compiled packs** contain TypeScript implementation code that is bundled into a
   reviewed extension build. They ship only through an extension release and are
   not installed or updated independently at runtime.

Local development packs are compiled into an unpacked development build. Developer
mode is visibly distinct, uses a separate extension identity and native-host name,
and is never enabled by a marketplace action.

This foundation ADR deferred third-party remote distribution. The safe signed
declarative distribution boundary is subsequently defined by
[ADR 0013](0013-community-pack-trust-and-lifecycle.md) and
[ADR 0014](0014-registry-discovery-and-origin-authority.md), pending their
follow-up implementation issues and Chrome Web Store release gate.

The runtime must not use `eval`, `Function`, remotely hosted scripts, downloaded
WebAssembly, dynamic code generation, or an equivalent mechanism to execute pack
logic. Registry responses are metadata and signed declarative artifacts, never code.

A version 1 pack declares at least:

- manifest version, pack ID, semantic version, publisher identity, and content
  digest;
- compatible runtime and bridge protocol ranges;
- exact HTTPS origins and path match rules;
- tool names, descriptions, input/output JSON Schemas, and fixtures;
- risk and required permission classes;
- explicit network policy, defaulting to no extension-originated requests; and
- compatibility evidence metadata that is informational until locally verified.

Pack IDs and tool names are globally namespaced by publisher. An immutable release
is identified by publisher key, pack ID, version, and content digest. Any permission,
origin, schema, or implementation change produces a new immutable release.

Declarative operation primitives are allowlisted, bounded, and capability-specific.
A primitive is added to the runtime only through normal code review, tests, and an
extension release. Version 1 does not include a generic DOM query language powerful
enough to become arbitrary page scripting.

Native WebMCP remains the first capability source. A pack cannot override a native
tool with the same logical identity; collisions are deterministic and visible.

## Consequences

- Registry compromise cannot silently introduce executable browser code.
- Complex integrations may require an extension release or a future reviewed
  sandbox model.
- The declarative operation vocabulary must remain deliberately small.
- Compatibility tests can run the same artifact the user installs.
- Pack updates that expand origins or permissions require explicit user review.
- Marketplace velocity is lower than unrestricted script distribution, in exchange
  for a substantially smaller authenticated-browser attack surface.

## Alternatives considered

### Download and execute signed JavaScript

Rejected. Signatures establish publisher identity and integrity, not safety. This
also creates remote-code and extension-store policy problems.

### Sandbox arbitrary JavaScript in an iframe or worker

Rejected for version 1. A sandbox still needs privileged host APIs to be useful, and
those APIs become an ambient capability surface. A future design would require a
separate threat model and ADR.

### Only ship compiled first-party packs

Acceptable for the first demo but insufficient as the long-term pack ecosystem.
Declarative packs preserve independent delivery without remote executable code.

### Trust marketplace review and publisher reputation

Rejected as an enforcement mechanism. Review and reputation are evidence for a
user decision, not a substitute for runtime least privilege.

## References

- [Chrome extension Manifest V3](https://developer.chrome.com/docs/extensions/reference/manifest)
- [Chrome extension permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
