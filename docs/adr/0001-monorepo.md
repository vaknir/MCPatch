# ADR 0001: Start with a polyglot monorepo

- Status: Accepted
- Date: 2026-09-15
- Issue: [#4](https://github.com/vaknir/MCPatch/issues/4)

## Context

MCPatch has a Rust bridge, a TypeScript extension and SDK, and a language-neutral
wire protocol. A protocol change often requires schemas, fixtures, Rust types,
TypeScript types, and compatibility tests to move together.

Separate repositories would create independent release permissions, duplicated CI,
and a window where components disagree on a security-sensitive contract. A
monorepo can also become expensive if every component shares one dependency graph
or one release version.

## Decision

Use one repository with two deliberately separate workspace systems:

- a Cargo workspace for Rust crates;
- a pnpm workspace for JavaScript and TypeScript packages and applications; and
- canonical protocol schemas and golden fixtures under `packages/protocol`.

The root commands orchestrate checks but do not hide the native commands. Packages
may have independent SemVer releases. The bridge protocol and pack manifest use
their own integer compatibility versions.

Add a component directory only when it contains working code or documentation.
Turborepo is deferred until task graph caching provides measured value.

## Consequences

- Cross-language contract changes can be reviewed and tested atomically.
- Contributors need both Rust and Node.js toolchains for all-workspace checks.
- CI may split Rust and TypeScript jobs while using the same commit and fixtures.
- Ownership and release automation must preserve package boundaries.
- The registry can move to a separate private service repository later without
  changing the runtime protocol.

## Alternatives considered

### Repository per component

Rejected for the foundation because coordinating protocol changes and security
reviews across repositories would add risk before independent release cadence is
useful.

### TypeScript-only repository

Rejected because the local bridge is a long-running native security boundary and
should not inherit the browser toolchain by convenience.

### Turborepo from the first commit

Deferred. pnpm and Cargo already provide workspaces; another orchestration layer is
not justified until build performance or task dependencies require it.
