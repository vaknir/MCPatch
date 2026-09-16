# Changelog

All notable MCPatch changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and product releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Architecture for safe community pack distribution: separate official,
  reviewed-community, and unsigned-local trust tiers; attributable install and
  update state transitions; fixed-origin registry control-plane discovery without
  tab surveillance; exact-origin user-gesture authority; offline freshness and
  revocation rules; and a Chrome Web Store/MV3 release gate for remote-data
  interpreters and arbitrary-origin optional host declarations.
- A reviewed TradingView pack with bounded `tradingview.current_chart` and
  `tradingview.current_watchlist` reads, canvas-scoped bounded
  `tradingview.capture_chart` native MCP image results, constrained canonical
  `tradingview.search_symbols` discovery through one exact credential-free
  first-party origin, plus an argument-bound
  `tradingview.change_symbol` action and approved, postcondition-checked
  `tradingview.add_to_watchlist` / `tradingview.remove_from_watchlist` actions using
  canonical `EXCHANGE:TICKER` identities, plus a one-attempt
  `tradingview.create_price_alert` action with explicit condition, threshold,
  frequency, expiry, notification behavior, and postcondition state using the
  browser's unexported site session,
  exact optional-origin enablement, native-first resolution, and fail-closed
  English single-chart compatibility checks.
- A cross-language bounded media-result contract with one closed PNG/WebP content
  block, shared count/dimension/decoded-byte validation, SDK authoring support,
  page-channel transport, native MCP image projection in the Rust bridge, and a
  closed protocol-v2 wire contract that retains the historical v1 schemas.
- A one-object browser pack SDK at `@mcpatch/sdk/browser` that registers real typed
  page handlers and generates capability discovery, routing, cancellation, safe
  errors, subscriptions, tool lists, and fail-closed compiled fallbacks, with safe
  manifest and permission defaults.
- Reviewed external-session `POST` authority paired only with approved
  `ACTION + EXTERNAL_NETWORK` pack tools, while malformed, sensitive, credential,
  arbitrary-execution, and native combinations remain denied.
- A FastMCP-style `MCPatch` pack-authoring facade with typed `.tool(...)`
  registration, directly testable handlers, immutable single-use finalization,
  registration-time identity checks, and explicit runtime JSON Schemas.
- A typed `flights.search` ACTION for one-adult economy round trips between exact
  airport codes and bounded future dates. It generates one fixed same-origin search
  URL, lets Google use the tab's browser session, and acknowledges before navigation
  without form automation, captured-request replay, or credential transport.
- An extension-owned, tab-bound one-time approval UI with a closed hash-only
  presentation channel, bounded prompts, one-shot decisions, and fail-closed sender,
  lifecycle, timeout, malformed-message, and presentation handling.
- Reviewed Google Flights pack bundling with exact optional-origin enablement,
  document-local execution, page-reported capability projection, fail-closed
  service-worker fallbacks, and native WebMCP precedence.
- Bounded Google Flights semantic extraction for current search state, visible
  results, and price insights, with invented fixtures, strict English fingerprint
  checks, cancellation, and coalesced mutation refresh.
- A fail-closed `google-flights-rendered-en-v1` contract and scrubbed public-page
  reconnaissance for the first real read-only pack.
- Deterministic real-Chromium fixture coverage for profile-scoped Native Messaging,
  MV3 enablement, page capability projection, MCP discovery and calls, DOM refresh,
  cancellation, navigation replacement, malformed page isolation, and revocation,
  with deny-all network controls and production-artifact leak checks.
- Reproducible local bridge/extension packaging with source-commit metadata and
  per-file SHA-256 digests, plus deterministic public extension identity and
  user-level Native Messaging install, dry-run, idempotent update, receipt-bound
  recoverable uninstall, and cross-platform registration-plan tests.
- Internal extension page-channel protocol version 2 with bounded duplicate-aware
  JSON parsing, direction validation, exact document bindings, worker-authorized
  pack-tool selection, and golden fixtures.
- A static reviewed document-adapter router that constructs only matching authorized
  bundled adapters and preserves native WebMCP precedence.
- Top-level document context ownership through browser-attested content ports with
  deny-by-default origin authority, navigation replacement, bounded discovery and
  calls, exact cancellation, and an inert isolated-world content runtime bundle.
- Explicit extension-action pack enablement with a closed trusted-storage record,
  exact optional-origin grants, deterministic isolated content registration, and
  fail-closed reconciliation across startup, corruption, permission, and disable.
- Isolated native WebMCP draft adapter with same-origin no-option discovery,
  explicit read-only metadata admission, opaque handle retention, bounded calls and
  results, deterministic duplicate rejection, cancellation, and lifecycle refresh.
- Bridge-owned one-time approvals bound to canonical argument hashes, exact active
  routes and pack identities, with random nonces, bounded expiry, atomic consumption,
  replay denial, lifecycle revocation, and deterministic denial when the trusted
  extension surface is unavailable.
- Pre-release protocol-v1 approval correction removing raw arguments from approval
  messages before the first distributed build; hash-only approval messages are now
  the frozen version-1 shape.
- Initial architecture, trust boundaries, and roadmap.
- Security policy and threat model.
- ADRs for the monorepo, Rust bridge, Native Messaging transport, bridge protocol,
  pack execution, permissions, and approvals.
- Cargo and pnpm workspaces with formatting, linting, tests, builds, dependency
  audits, CI, and automated dependency updates.
- Historical bridge protocol version 1 and current version 2 schemas with
  cross-language golden fixtures.
- Rust protocol types with strict JSON decoding, bounded semantic validation,
  typed errors, and shared-fixture contract tests.
- Dependency-free TypeScript protocol types and deterministic runtime validation
  suitable for the Manifest V3 extension boundary.
- Downgrade-resistant protocol version negotiation and shared Rust/TypeScript
  compatibility cases.
- Bounded Rust MCP stdio process with structured stderr logging, lifecycle handling,
  version negotiation, and an empty tool-list foundation.
- Transport-independent browser connection contract and bounded deterministic fake
  adapter for policy and routing tests.
- Context-scoped capability registry with monotonic snapshots, deterministic
  collision handling, deny-by-default permissions, schema validation, exact result
  binding, and cancellation/revocation hooks.
- Local IPC and per-user bridge-core lifecycle decision covering secure Unix and
  Windows endpoints, process election, framing, peer identity, and crash recovery.
- Minimal strict TypeScript Chromium MV3 extension with synchronous lifecycle
  registration, reproducible build output, and zero browser or host permissions.
- Bounded Native Messaging host adapter with exact caller-origin policy, strict
  protocol decoding, bidirectional typed relay, and audit-safe process behavior.
- User-private Unix local IPC primitives with distinct role endpoints, strict
  little-endian JSON framing, peer-UID authentication, and safe socket cleanup.
- Authenticated cross-platform adapter connections, bounded connect-first core
  rendezvous, and isolated current-executable process start with no inherited adapter
  standard streams or Windows handles.
- Native Messaging lifecycle wiring that authorizes before input or rendezvous,
  relays through the authenticated browser endpoint with capacity-one backpressure,
  and closes both boundaries on browser or local IPC failure.
- Core-owned MCP sessions with a bounded newline-to-local-frame stdio adapter,
  shared per-role session limits, partial-frame deadlines, and authenticated async
  Unix and Windows relay lifecycles.
- Process-level bridge-core race, idle-stop, crash-revocation, and reconnect coverage,
  with Unix stale-socket replacement gated by the exact held channel election.
- Core-owned browser hello negotiation, process-scoped connection identities, bounded
  bidirectional queues, heartbeat expiry, direction enforcement, and disconnect
  revocation through the shared capability registry.
- Downgrade-verifiable hello acknowledgements that carry the acceptor's bounded
  supported-version set for initiator-side recomputation.
- Manifest V3 native-session supervision with strict hello acknowledgement,
  fixed-host Native Messaging, bounded heartbeats and reconnects, fail-closed
  direction checks, and no cross-connection message replay.
- Cross-platform process coverage for browser negotiation, heartbeat, violation
  isolation, disconnect revocation, fresh reconnect identities, and core restart
  through Native Messaging plus authenticated local IPC.
- Negotiated browser-session ingestion for atomic capability snapshots, context
  closure, bound tool responses, and cancellation dispatch.
- Bundled extension demo capability with post-negotiation publication, exact
  request binding, deterministic typed results, reconnect snapshots, and explicit
  context closure without site permissions.
- Live MCP `tools/list` projection of policy-visible registry capabilities with
  stable ordering, exact schemas, conservative annotations, and no internal route
  metadata.
- MCP `tools/call` routing through bridge-owned correlation IDs, exact browser
  completion, schema enforcement, bounded deadlines, cancellation propagation, and
  safe errors that do not expose rejected browser data or internal route metadata.
- Cross-platform process proof for the bundled demo across Native Messaging,
  authenticated local IPC, bridge-core discovery/routing, and MCP stdio, including
  context closure, disconnect revocation, and fresh publication after core restart.
- Separately versioned Pack Manifest v1 types, closed JSON Schema, bounded semantic
  validator, compatibility policy, and shared valid/invalid golden cases for both
  declarative metadata and reviewed extension-bundled packs.
- Strict pack authoring primitives with common JSON Schema type inference,
  immutable definitions, a minimal execution context, and separate serializable
  manifests and reviewed compiled-handler tables.
- Pure bounded pack matching and context-bound capability resolution with canonical
  HTTPS origins, native WebMCP precedence, stable ordering, and explicit fail-closed
  collision diagnostics.
- Deterministic compiled-pack fixture verification with whole-pack preflight,
  runtime and bridge compatibility checks, explicit permission ceilings, typed
  error cases, result-schema validation, deadlines, and payload-free evidence.
- Reviewed synthetic pack workspace and codegen-free MV3 compiled-pack runtime with
  exact SDK matching, native WebMCP precedence, bounded schema interpretation,
  typed calls, result validation, cancellation, and lifecycle revocation.

### Changed

- Pack Manifest v1 now requires closed output schemas as well as closed input
  schemas: the root is an object with `additionalProperties` set to `false` or to
  a closed subschema, every subschema declares `type`, `const`, or `enum`, nested
  objects are closed, arrays declare `items`, and `not` is rejected.
  `validatePackManifest` reports the first violation at the exact subschema path.
  The output schema is the only allowlist between page content and the MCP
  client, so an open output schema is now a manifest error rather than a review
  concern.
- Bridge protocol v1 capability snapshots now reject a `source: "pack"`
  capability that omits `outputSchema`, in the JSON Schema and in both the Rust
  and TypeScript validators. Native WebMCP capabilities may still omit it.

### Fixed

- A Linux host without `XDG_RUNTIME_DIR` (containers, `cron`, services without a
  PAM session, some SSH configurations) failed with the opaque
  `local_core_unavailable` or, two seconds later, `core_startup_timeout`. The
  adapters now report `local_core_runtime_directory_unavailable`, the core reports
  `core_runtime_directory_unavailable` or `core_runtime_directory_unsafe`, and
  every such line carries a fixed, path-free `hint`. A `MCPATCH_RUNTIME_DIR`
  override selects the base directory for hosts without a session directory; it
  never relaxes the ownership or mode checks. The stdio process tests provision
  their own private directory so `cargo test` no longer depends on the login
  session, and the requirement is documented in `docs/installation.md`.
- The README no longer says the Google Flights field smoke is outstanding; it
  links the recorded report.

### Removed

- The unused `activeTab` extension permission. The toolbar gesture receives its
  tab from `action.onClicked`, and `activeTab` with `scripting` would have granted
  a click-to-inject capability nothing used. The manifest test now pins the exact
  permission set and asserts that no web-accessible resources are declared.

### Fixed

- Protocol and SDK JSON value types now agree on immutable array values, allowing
  generated browser packs to cross the page boundary without unsafe wrapper casts.
- Isolated MCP session cancellation from the core-wide shutdown token so an
  initialized client disconnect starts the idle grace period instead of stopping the
  shared core.
- Native-host peer-driven shutdown no longer waits indefinitely for Tokio's
  uncancellable blocking standard-input read.
- Registry-rejected browser traffic now passes through common connection cleanup,
  preventing leaked capabilities or pending calls after a stale or mismatched
  lifecycle message.

[Unreleased]: https://github.com/vaknir/MCPatch/compare/main...HEAD
