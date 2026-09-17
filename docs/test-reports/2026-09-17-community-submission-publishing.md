# Community submission and publishing report — 2026-09-17

Status: **passed locally**

Scope:

- GitHub issue: `#152` — reproducible community submission and registry publishing
- source branch: `feat/152-submission-workflow`
- host: macOS arm64
- Node.js: 24.19.0
- pnpm: 11.19.0
- Rust: 1.98.1
- browser: isolated temporary Chromium profile

Local release gates:

- `pnpm verify:community-pack <temporary-pack>`
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
- CLI: 13 tests passed;
- extension: 276 tests passed;
- packaging scripts: 3 tests passed;
- every Rust workspace unit, integration, process, and documentation test passed;
- JavaScript and Rust dependency audits reported no known vulnerabilities; and
- the real Chromium suite passed its synthetic end-to-end scenario, with the two
  opt-in live-site field scenarios skipped.

Contributor dry run:

- command: `pnpm verify:community-pack <temporary-pack>`;
- source commit: `13ad9cefa5428fbd3b9a10541724bd420f6248ee`;
- unsigned bundle digest:
  `sha256:25f5371304f7d9f5edee821dcbbfee21eca3abc28ec339331a49200d07226dc4`;
- one invented fixture passed; and
- output was explicitly marked `signed: false` and contained a separate review report.

Deterministic submission-to-index process fixture:

- publisher-signed bundle digest:
  `sha256:b54588584676e1d95a76f955a9efe08f2f67589ea45e273a96ec33bc6be5b29d`;
- signed index digest:
  `sha256:f5d48a77a99ae90eff47aa3be11d2c176285a86e94109aa49eb9319587889248`;
- the fixture used fixed ephemeral test-only Ed25519 keys and timestamps;
- a second run reproduced and reused the byte-identical publication tree; and
- dirty registry/source trees, publisher-bundle substitution, altered review
  authority, unsafe paths, missing keys, and dirty output failed closed.

Security notes:

- contributor output cannot sign or publish a registry entry;
- the review report contains identity, source commit, digest, compatibility,
  origins/paths, operations/selectors, schemas, risks, permissions, network policy,
  and payload-free fixture status only;
- maintainers reproduce source and fixtures before independently signing registry
  membership;
- signing keys are environment-only and absent from outputs; and
- no browser profile, credential, live user data, fixture payload, private key, or
  generated temporary artifact was retained with this report.

GitHub-hosted Actions were unavailable because the repository's Actions jobs could
not start under the account billing/spending limit. This report records the
equivalent local checks used for review and merge.
