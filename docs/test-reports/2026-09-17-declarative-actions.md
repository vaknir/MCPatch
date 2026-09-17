# Declarative Actions v1 report — 2026-09-17

Status: **passed locally**

Scope:

- GitHub issue: `#153` — approved declarative same-origin navigation;
- source branch: `feat/153-declarative-actions`;
- host: macOS arm64;
- Node.js: 24.19.0;
- pnpm: 11.19.0;
- Rust: 1.98.1; and
- browser: isolated temporary Chromium profile with a deny-by-default network
  route.

Local release gates:

- `pnpm build`
- `pnpm test`
- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm audit --audit-level high`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets --locked -- -D warnings`
- `cargo test --workspace --locked`
- `cargo audit`
- `pnpm test:browser`
- `git diff --check`

Results:

- protocol: 118 tests passed;
- SDK: 201 tests passed;
- example, Google Flights, and TradingView packs: 2, 43, and 34 tests passed;
- CLI: 14 tests passed;
- extension: 279 tests passed;
- packaging scripts: 3 tests passed;
- every Rust workspace unit, integration, process, and documentation test passed;
- JavaScript and Rust dependency audits reported no known vulnerabilities; and
- the real Chromium suite passed its synthetic end-to-end scenario, with the two
  opt-in live-site field scenarios skipped.

Browser proof:

- a signed community update introduced `community.open_item` as an Operations v2
  `ACTION` tool;
- MCP `tools/list` exposed the typed tool only after the matching document's page
  handshake;
- MCP `tools/call` opened the extension-owned prompt containing the exact tool,
  origin, and arguments;
- one approval produced only the canonical
  `{ "state": "scheduled", "url": "https://community.mcpatch.test/items/next" }`
  result;
- the test held the destination response and observed that the old community
  capabilities were absent before allowing the destination document to load; and
- the read and action capabilities returned only after the destination's fresh
  content-runtime handshake.

Security evidence:

- Operations v1 accepts reads only; Operations v2 adds only separately versioned
  typed navigation;
- dynamic values cannot control scheme, host, port, userinfo, path separators,
  query keys, fragments, redirects, requests, selectors, forms, or JavaScript;
- path/query values are bounded and encoded as components, while traversal,
  absolute/protocol-relative URLs, encoded path syntax, controls, and backslashes
  fail closed;
- bridge approval tests prove exact argument hashing, origin/tool/capability and
  context binding, expiry, denial, cancellation, one-time consumption, concurrent
  decision safety, and lifecycle revocation; and
- compiled Google Flights and TradingView actions remain unchanged and their full
  suites pass.

GitHub-hosted Actions were unavailable because the repository's Actions jobs could
not start under the account billing/spending limit. This report records the
equivalent local checks used for review and merge.
