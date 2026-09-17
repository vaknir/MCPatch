# Changelog

All notable MCPatch changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and product releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Declarative Operations v2 typed same-origin navigation actions, with static
  signed path/query templates, bounded component-encoded arguments, ACTION-only
  one-time approval, revoke-before-navigation document lifecycle, SDK and CLI
  fixture support, and a disposable Chromium proof through the real MCP bridge.
  Operations v1 read-only packs remain byte- and behavior-compatible.

- A reproducible community contribution and publication workflow: `pack submit`
  emits an unsigned canonical artifact plus payload-free authority report, while
  maintainer-only `registry publish` requires clean exact source commits, re-runs
  synthetic fixtures, reproduces reviewed bytes and metadata, verifies the separate
  publisher signature, and only then applies registry signing. Contributor issue/PR
  templates and key-rotation, transfer, fixture, and protected-release procedures
  complete the review boundary.

- Explicit community-pack upgrades with complete pinned authority records, strict
  SemVer upgrade selection, same-version identity-reuse rejection, one verified
  rollback artifact, transactional restoration after interrupted activation,
  startup refresh, and signed emergency revocation before context/script cleanup.
  The real Chromium fixture now proves install, reviewed update, MCP invocation,
  revocation, and MCP capability removal through the complete bridge path.

- A fixed-origin signed static community registry with bounded versioned index
  schema, independent publisher signatures and registry attestations, immutable
  digest-addressed bundles, rollback/freshness enforcement, credential-free strict
  transport, verified offline restore, extension-owned install review, exact-origin
  activation, transactional multi-source declarative registration, and a
  reproducible environment-keyed `mcpatch registry build` publisher. A disposable
  Chromium fixture now proves dynamic registry install through Native Messaging,
  the Rust bridge, MCP discovery, and MCP invocation.

- A dynamic exact-origin content catalog that combines reviewed and installed
  declarative packs behind one deterministic packaged content-script registration
  per origin, verifies grants from Chromium's complete permission inventory,
  shares permission ownership across pack sources, migrates legacy registrations,
  and revokes contexts before aggregate identity or path changes.

- An extension-owned local pack developer mode that previews and confirms
  unsigned declarative bundles, requests exact HTTPS origins from a trusted user
  gesture, persists bounded validated records, and routes enabled tools through
  the packaged interpreter, bridge, and MCP path with fail-closed lifecycle
  reconciliation.

- A strict `mcpatch pack` community workflow for creating, validating, testing,
  inspecting, and reproducibly building data-only declarative packs, with inert
  fixture execution, Git source attribution, atomic no-overwrite publication, and
  payload-safe process errors.

- A bounded read-only declarative pack interpreter for the extension, using
  opaque document handles, static packaged DOM traversal, strict scalar parsing,
  incremental node/byte budgets, schema-valid output, exact
  tab/document/origin/path/context/digest binding, and revoke-before-cleanup
  cancellation without changing compiled pack behavior.

- A browser-free declarative authoring entrypoint with branded locator, scope, and
  projection builders; explicit read authority and fixture coverage; deterministic,
  deeply frozen bundle build inputs; and a synthetic-document runner boundary for
  the bounded declarative interpreter.

- Declarative Operations v1 (initial pre-release definition): an immutable, closed,
  read-only AST embedded at
  `operations.program`, with one operation per manifest tool, static role and
  structured selectors, bounded descendant reads and projections, exact resource
  limits, output-schema parity checks, malicious golden fixtures, and stable
  payload-safe validation/runtime error taxonomies. The contract is deliberately
  not computationally complete and exposes no script, network, mutation, storage,
  credential, raw HTML, style, canvas, or ambient browser primitive.

- Declarative Pack Bundle v1: one canonical UTF-8 JSON .mcpack artifact with
  duplicate-safe strict ingestion, RFC 8785/JCS bytes, bounded immutable content,
  domain-separated SHA-256 digest, trusted-lookup Ed25519 publisher signatures,
  separate registry attestation semantics, compatibility checks, schema, golden
  vectors, and payload-safe errors. The fixed @noble/ed25519 verifier preserves
  the Chrome 106 extension floor; this contract adds no executable bundle surface.
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

- A per-site approval prompt budget in the bridge: six prompts in a burst per
  browser connection and origin, refilling one every ten seconds, and a
  sixty-second cooldown after three consecutive non-approvals. A refused prompt
  fails the MCP call with an explanatory tool failure before any nonce is
  generated or browser message sent. The extension opens a prompt without
  stealing focus when a denial was seen in the last minute.

- ADR 0015 defines when a read is `SENSITIVE`: content the user has already
  rendered in the current document and credential-free network reads are
  `READ`; undisplayed account data and high-impact content such as credentials
  or private correspondence are `SENSITIVE`. The shipped TradingView and Google
  Flights reads are classified by that rule, the review checklist cites it, and
  the bundled permission ceiling is unchanged.

- Progress notifications during the approval wait: when the MCP client supplies
  a progress token, the bridge sends `notifications/progress` with a fixed,
  argument-free message on dispatch and every ten seconds until the user
  decides. The approval wait is configurable with `MCPATCH_APPROVAL_TIMEOUT_SECS`
  (5–300 seconds; invalid values are ignored and logged). When the client stops
  waiting while a prompt is on screen, the extension keeps the prompt visible
  for eight seconds with a notice that nothing was approved instead of closing
  it under the user's cursor.

- A per-connection capability snapshot budget in the bridge: thirty snapshots
  in a burst, refilling ten per second, charged only for snapshots that would
  compile schemas. A connection over budget is refused with
  `SnapshotRateLimited` and its session closed with the distinct
  `browser_session_snapshot_flood` code so bridge and page state cannot drift.
  Compiled validators are now shared across snapshots by exact schema bytes in a
  bounded cache, so republishing unchanged tools costs no recompilation.

- The Google Flights search action no longer navigates after a cancelled call:
  the deferred navigation checks the call's abort signal, so a late cancel is
  honoured instead of the timer firing regardless. An unauthorized target now
  fails during the call rather than silently afterwards. The opaque `tfs`
  parameter gained a decoder and a golden round-trip test, so a change to the
  encoder's field numbers is visible in review instead of sending a user to a
  search they did not approve.
- Navigation is now an approved-action capability. The isolated realm loses
  `location.assign`, `location.replace`, assignment to `location.href`,
  `window.open` and form submission, so a `read` tool has no side effect left
  beyond reading the DOM. The single captured entry point is handed to a pack
  through a gate that refuses unless one of that pack's approved `ACTION` tools
  is running and the target is a page its manifest matches, and that authorizes
  one navigation per call. In the SDK an action tool's context gains
  `navigate`, which a read tool's context does not have. Google Flights and
  TradingView now navigate through it instead of touching `location` directly.
- Content scripts are now registered for the paths a pack declares instead of
  its whole origin, so the reviewed Google Flights bundle runs on
  `/travel/flights` and `/travel/flights/search` rather than on every page of
  `www.google.com`. A `prefix` rule of `/` still covers a host, but only when
  the match sets the new `wholeOrigin: true` flag, which is rejected without
  such a rule so the grant cannot be read past. Host permissions stay
  origin-granular because Chrome grants them that way.
- Native WebMCP tool metadata is now isolated from the agent's context. A
  page-declared tool is published under the reserved `native` namespace,
  qualified by its origin, so it can no longer be listed under a reviewed
  pack's name; the bridge rejects a native capability outside that namespace
  and a pack capability inside it, and the JSON Schema carries the same rule.
  The bridge publishes its own attributed description naming the origin and
  stating that MCPatch has not reviewed the tool, quoting the page's text as
  bounded, control-character-free data, and drops the page-authored title.
  A page can therefore no longer hide a reviewed pack tool by claiming its
  name: the two are listed side by side.
- Every native WebMCP call now requires an argument-bound one-time approval.
  A page declares its own tool's risk and permissions, so an allow resting on
  them was an allow decided by untrusted input: a site whose tool genuinely
  wrote executed with no human decision because MCPatch had relabelled it a
  read. The bridge now turns such an allow into an approval, leaves genuine
  denials denied, and emits no read-only, destructive or idempotent hint for a
  native tool, so MCPatch no longer vouches to an MCP client for behaviour it
  has not reviewed. Recorded in ADR 0016.
- A per-document capability snapshot gate in the extension: publications
  coalesce to at most one per 250 ms, with the first request in an idle window
  running immediately and a flood of any size collapsing into one trailing
  publication, and a snapshot whose canonical capability set is unchanged is
  not republished at all. This completes the per-context half of the snapshot
  rate bound whose per-connection half already lives in the bridge.
- Isolated-realm lockdown for compiled packs
  (`apps/extension/src/realm-lockdown.ts`), installed before any pack code runs:
  the content-script realm's `fetch` is replaced with an MCPatch-owned wrapper
  that requires `https:`, allows only the pack's declared request origins, strips
  `Authorization`/`Cookie` headers, and bounds body size; `XMLHttpRequest`,
  `WebSocket`, `EventSource`, and `navigator.sendBeacon` are removed; and
  `document.cookie` throws. Every replacement is frozen and non-configurable, and
  a lockdown failure publishes no capability snapshot. This turns the
  declared-origin network bound and the no-cookie bound from review into
  mechanism for every compiled pack, with no policy change; documented in
  `docs/architecture/realm-lockdown.md`.
- Per-tier pack-boundary enforcement-status tables in THREAT_MODEL.md,
  ARCHITECTURE.md, and pack-manifest-v1.md, stating for each compiled-pack claim
  whether it is enforced by mechanism or by review today, with the declarative
  tier marked not-yet-shippable; CONTRIBUTING.md now requires an ADR to move a row
  from review to mechanism, and the README status links the tables.
- A security regression suite that pins red-team findings against regression: a
  `mcpatch mcp-stdio` abuse test (hostile bytes never leaving the process,
  frame-abuse termination with a stable code, continuation-state refusal,
  bounded concurrency, and pinned version negotiation), hostile-page adapter and
  worker tests (serialization-hook and over-long-description rejection,
  `toolchange`-flood coalescing, and the approval page being unreachable from web
  content), and stronger Windows named-pipe/mutex DACL assertions, documented in
  `docs/testing/security-regression-suite.md`.
- Readable, attributed approval prompts: `approval_required` now carries the
  bridge-validated arguments the grant's hash commits to and the requesting MCP
  client and bridge session, and the trusted approval page renders both as inert
  text beside the hash. The client name is trimmed and limited to short printable
  ASCII (else `unknown client`), arguments stay out of every log, and the
  pre-freeze protocol-v2 addition is recorded in
  `docs/architecture/protocol-v2-approval-presentation.md`.

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
- Bridge protocol v1 capability schemas are now restricted, on both sides and in
  the JSON Schema, to the keyword allowlist the extension's interpreter already
  enforced (`type`, `const`, `enum`, `properties`, `required`,
  `additionalProperties`, `items`, and the numeric and length bounds), with
  `type` limited to one JSON type; the first unsupported keyword is reported at
  its exact path. The bridge compiles its validators with format assertions
  disabled. The bridge no longer relies on the extension being the only layer
  that refuses `pattern`, `format`, `$ref`, or combinators.

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
- An approved action no longer fails with "The approval is no longer valid" when
  a second tab or browser profile publishes the same tool name while the human is
  deciding. The bridge now dispatches an approved call to the exact registration
  the approval was bound to instead of resolving the tool name again, and reports
  the distinct `ApprovalContextChanged` outcome—with guidance to request a fresh
  approval—only when that registration was replaced or closed before dispatch.

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
