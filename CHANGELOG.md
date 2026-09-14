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

[Unreleased]: https://github.com/vaknir/MCPatch/compare/main...HEAD
