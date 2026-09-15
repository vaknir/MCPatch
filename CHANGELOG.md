# Changelog

All notable MCPatch changes are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and product releases use
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial architecture, trust boundaries, and roadmap.
- Security policy and threat model.
- ADRs for the monorepo, Rust bridge, Native Messaging transport, bridge protocol,
  pack execution, permissions, and approvals.
- Cargo and pnpm workspaces with formatting, linting, tests, builds, dependency
  audits, CI, and automated dependency updates.
- Canonical bridge protocol version 1 schemas and cross-language golden fixtures.
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

### Fixed

- Isolated MCP session cancellation from the core-wide shutdown token so an
  initialized client disconnect starts the idle grace period instead of stopping the
  shared core.

[Unreleased]: https://github.com/vaknir/MCPatch/compare/main...HEAD
