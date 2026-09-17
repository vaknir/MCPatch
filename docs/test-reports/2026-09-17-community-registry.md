# Community registry report — 2026-09-17

Status: **passed locally**

Scope:

- GitHub issue: `#150` — signed static community pack registry and extension client
- source branch: `feat/150-signed-registry`
- host: macOS arm64
- Node.js: 24.19.0
- pnpm: 11.19.0
- Rust: 1.98.1
- browser: isolated temporary Chromium profile

Local release gates:

- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm audit --audit-level high`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `cargo test --workspace --locked`
- `cargo audit`
- `pnpm test:browser`

Results:

- protocol: 118 tests passed;
- SDK: 179 tests passed;
- example, Google Flights, and TradingView packs: 2, 43, and 34 tests passed;
- CLI: 10 tests passed;
- extension: 263 tests passed;
- packaging scripts: 3 tests passed;
- every Rust workspace unit, integration, process, and documentation test passed;
- JavaScript and Rust dependency audits reported no known vulnerabilities; and
- the real Chromium suite passed its synthetic end-to-end scenario, with the two
  opt-in live-site field scenarios skipped.

End-to-end evidence:

- a signed registry index was fetched from the one fixed fixture origin;
- the extension fetched the exact digest-addressed immutable bundle path;
- registry and publisher signatures, digest, identity, compatibility, freshness,
  revocation state, schemas, permissions, and semantic summary were verified;
- the extension-owned review surface displayed the verified pack contract;
- an exact-origin grant enabled only the selected declarative pack;
- the dynamic pack registered `community.visible_text` from the matching page;
- an MCP client discovered and invoked that tool through stdio, the Rust bridge,
  Native Messaging, the extension, and the isolated page; and
- invalid, stale, ambiguous, colliding, redirected, oversized, truncated,
  substituted, revoked, and unauthorized inputs fail closed in deterministic tests.

Security notes:

- no cookie, token, credential, browser storage, generic JavaScript, unrestricted
  network, raw DOM, or browser-control capability crossed the MCP boundary;
- invalid online registry data cannot silently downgrade to a cached index;
- cached artifacts are usable only while cryptographically valid and fresh;
- durable records bind publisher, pack ID, version, digest, and verified bytes;
- the synthetic registry pregrant exists only in the test artifact because headless
  Chromium cannot operate its browser-owned optional-permission prompt; and
- no browser profile, pack output, signing key, or registry response was retained in
  this report.

GitHub-hosted Actions were unavailable because the repository's Actions credits were
exhausted. This report records the equivalent local checks used for review and merge.
