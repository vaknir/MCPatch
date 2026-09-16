# Versioning and release policy

## Version domains

MCPatch has five independent compatibility domains.

| Domain                | Format           | Initial value | Changes when                                                       |
| --------------------- | ---------------- | ------------- | ------------------------------------------------------------------ |
| Product release       | SemVer           | `0.1.0`       | Installable MCPatch behavior is released                           |
| Rust/npm package      | SemVer           | `0.1.0`       | A package API or implementation is released                        |
| Bridge protocol       | Positive integer | `2`           | Bridge↔extension wire compatibility changes                        |
| Page protocol         | Positive integer | `2`           | Service worker↔content-runtime compatibility changes               |
| Pack manifest         | Positive integer | `1`           | Pack manifest interpretation changes incompatibly                  |
| External MCP revision | Date string      | `2026-07-28`  | The upstream MCP specification publishes and MCPatch adopts a date |

Declarative Pack Bundle v1 is an additional artifact domain. It is independent
from Pack Manifest v1 and Declarative Operations v1. Its canonical projection,
digest domains, signature envelope, and registry-attestation separation are
documented in [Declarative Pack Bundle v1](architecture/declarative-pack-bundle.md).
Unknown bundle or operations versions fail closed; a change to accepted authority
or cryptographic projection requires a new version.

Declarative Operations v1 was reserved by the pre-release bundle contract; this
unreleased 0.1.0 implementation establishes its initial concrete read-only,
non-computational AST embedded in
`operations.program`. Its selector, projection, resource-limit, output-schema,
and permission semantics are versioned together. Tightening rejection of data
that is already outside the v1 language is compatible hardening; accepting a new
operation, side effect, dynamic reference, or authority requires a new operations
version and migration note.

Product and package SemVer may align for early releases but are not required to.
Bridge, page, and pack-manifest protocol numbers never derive from package versions.

## SemVer during pre-1.0 development

- Patch releases contain compatible fixes, security hardening, and documentation.
- Minor releases may change unstable APIs but require changelog and migration notes.
- Any change that breaks an API declared stable within `0.x` requires a minor bump.
- A security fix may intentionally remove unsafe behavior in a patch release; the
  release notes must identify the compatibility impact.

## Bridge protocol compatibility

Peers advertise supported protocol versions and select the highest common integer.
A peer may support more than one version during a migration window. No intersection
fails negotiation before capabilities or calls are accepted.

Protocol versions use closed message schemas. Adding, removing, renaming, or
changing the meaning of a field or message requires a new protocol version unless
the existing schema explicitly marks that location as extensible.

A protocol change must include:

- an ADR or compatibility note;
- canonical schema changes;
- valid and invalid golden fixtures;
- Rust and TypeScript compatibility tests;
- negotiation tests with the previous supported version; and
- migration and removal criteria.

Support for a protocol version cannot be removed without at least one product minor
release of deprecation notice during pre-1.0 development.

The internal page protocol uses the same closed-schema discipline but ships both
peers inside one extension artifact. Page protocol 2 replaced unreleased page
protocol 1 so the service worker can provide a trusted, sorted pack-tool allowlist
to the content runtime. No product release accepted page protocol 1, so it has no
deprecation window.

## Pack manifest compatibility

Manifest versions describe syntax and interpretation. Pack SemVer describes the
pack artifact. A pack requiring a new manifest format increments its own SemVer and
declares the new manifest integer.

Unknown manifest versions are rejected. Unknown permission classes, origin forms,
and executable operation types fail closed. A runtime may support several manifest
versions through explicit validators and migration code.

## External MCP compatibility

The initial bridge targets MCP `2026-07-28`. Compatibility with earlier MCP
revisions is provided only when covered by the official SDK and MCPatch integration
tests. External MCP support is listed separately in release notes because MCP uses
date-based revisions rather than MCPatch SemVer.

## Release process

Before a product release:

1. Ensure `main` is clean and every required check passes.
2. Update `CHANGELOG.md`, compatibility tables, and migration notes.
3. Verify dependency audits and protocol fixtures from a clean checkout.
4. Build all platform artifacts from the tagged commit.
5. Record artifact digests, source commit, toolchain versions, and signing identity.
6. Create an annotated `vMAJOR.MINOR.PATCH` tag and GitHub release notes.
7. Publish artifacts only after signatures and installation tests pass.

Automated publication, signing, and provenance are required before the first public
release and will be specified in a dedicated release-engineering issue.

The pre-alpha local equivalent is `pnpm package:local`. It requires a clean commit
and emits an `artifact-manifest.json` that binds every included file digest to that
full source revision. This is local provenance, not a substitute for signed release
attestations.
