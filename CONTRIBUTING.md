# Contributing to MCPatch

MCPatch is private and pre-alpha. Contributions should make the security boundary
easier to understand, test, and maintain.

## Before implementation

1. Find or create a focused issue with acceptance criteria and security impact.
2. For a material architecture or trust-boundary change, propose an ADR first.
3. Branch from an up-to-date `main` using `<type>/<issue>-<short-name>`, for example
   `feat/10-protocol-schemas` or `fix/42-origin-check`.
4. Add a failing test before important behavior, especially validation, policy,
   approvals, lifecycle, and routing.

Do not combine unrelated cleanup with a feature or security fix.

## Local checks

Use Node.js 22.13 or newer, pnpm 12.4.1, and the Rust toolchain pinned in
`rust-toolchain.toml`.

```sh
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm audit --audit-level high

cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features --locked
cargo build --workspace --all-targets --all-features --locked
cargo audit
```

Run the full set before opening a PR. During development, run the smallest relevant
test first.

The bridge process tests spawn real adapters and cores, which need a private
runtime directory. They provision their own, so a login session is not required;
if you run the built binary by hand on a Linux host without `XDG_RUNTIME_DIR`,
set `MCPATCH_RUNTIME_DIR` to a directory you own with mode `0700` (see
[docs/installation.md](docs/installation.md#runtime-directory)).

## Code rules

- Preserve the invariants in `SECURITY.md` and update `THREAT_MODEL.md` when a new
  boundary or capability is introduced.
- Validate untrusted input before policy or expensive work.
- Keep transport, protocol, policy, routing, and site behavior separate.
- Prefer small modules, explicit interfaces, typed errors, pure functions, and
  bounded data structures.
- Do not introduce generic browser, JavaScript, credential, filesystem, or network
  capabilities.
- Do not add a runtime dependency without documenting why the standard library or
  an existing dependency is insufficient.
- Document public APIs and comment on non-obvious reasons rather than syntax.
- Use synthetic fixtures; never commit real account or website data.

## Commits and pull requests

Commit messages and PR titles follow Conventional Commits:

```text
<type>(optional-scope): short imperative description
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`,
`revert`, `style`, and `test`. Add `!` and a `BREAKING CHANGE:` footer when a
SemVer-breaking public API change is intentional.

Each PR must:

- address one meaningful concern and link its issue;
- explain what changed and why;
- list exact tests run;
- describe security implications, including “none” with a reason;
- update docs, fixtures, changelog, and migration notes when required; and
- keep all CI checks green.

Use squash merge so the validated PR title becomes the main-branch commit. Do not
merge a red or pending PR. `main` must remain releasable.

## Review guidance

Reviewers should check behavior and failure paths before style. For security-boundary
changes, verify:

- malformed, denied, expired, replayed, and stale-state cases;
- exact origin, context, tool, pack, and argument binding;
- size, complexity, timeout, cancellation, and concurrency limits;
- absence of credentials and sensitive content from results and logs;
- each tool's risk class against the rules in
  [ADR 0015](docs/adr/0015-sensitive-read-classification.md): rendered content
  and credential-free network reads are `READ`; undisplayed account data and
  high-impact content are `SENSITIVE`; and
- cross-language fixture agreement.

## Release changes

Follow [docs/VERSIONING.md](docs/VERSIONING.md). Product, package, bridge protocol,
and pack manifest versions are independent. A package bump cannot substitute for a
protocol compatibility decision.
