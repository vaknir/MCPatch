# Community pack update report — 2026-09-17

Status: **passed locally**

Scope:

- GitHub issue: `#151` — safe community pack updates, rollback, and emergency revocation
- source branch: `feat/151-safe-updates`
- host: macOS arm64
- Node.js: 24.19.0
- pnpm: 11.19.0
- Rust: 1.98.1
- browser: isolated temporary Chromium profile

Local release gates:

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm audit --audit-level high`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `cargo test --workspace --locked`
- `cargo audit`
- `pnpm test:browser`
- `git diff --check`

Results:

- protocol: 118 tests passed;
- SDK: 180 tests passed;
- example, Google Flights, and TradingView packs: 2, 43, and 34 tests passed;
- CLI: 10 tests passed;
- extension: 276 tests passed;
- packaging scripts: 3 tests passed;
- every Rust workspace unit, integration, process, and documentation test passed;
- JavaScript and Rust dependency audits reported no known vulnerabilities; and
- the real Chromium suite passed its synthetic end-to-end scenario, with the two
  opt-in live-site field scenarios skipped.

End-to-end evidence:

- Chromium installed a signed version `1.0.0` artifact after extension-owned review;
- an MCP client discovered and invoked its typed capability through stdio, the Rust
  bridge, Native Messaging, the extension, and the isolated page;
- the extension staged signed version `1.1.0` without changing active authority;
- a second explicit review activated the update and retained exactly one verified
  rollback artifact;
- a second MCP call proved the updated implementation was authoritative; and
- a newer signed index emergency-revoked version `1.1.0`, immediately removing the
  MCP capability without downloading replacement code.

Security and recovery evidence:

- installed authority is pinned to publisher, ID, version, digest, publisher key,
  trust, operations version, and exact reviewed origins;
- duplicate release identities, downgrades, stale replay, changed digests, invalid
  signatures, missing releases, incompatible runtimes, and revoked artifacts fail closed;
- permission expansion and runtime activation failure leave the old artifact active;
- rollback uses only retained, previously verified local bytes and is unavailable
  when the previous release is revoked, stale, incompatible, or already consumed;
- revocation closes contexts and capabilities before cleanup;
- lifecycle audit events contain only fixed identity, digest, and status fields; and
- no cookie, token, credential, browser profile, signing key, registry response, pack
  output, or captured traffic was retained in this report.

GitHub-hosted Actions were unavailable because the repository's Actions jobs could
not start under the account billing/spending limit. This report records the
equivalent local checks used for review and merge.
