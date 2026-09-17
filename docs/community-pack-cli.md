# Community pack CLI

The local `mcpatch pack` workflow builds declarative community packs without
loading an author module or opening a browser. Its only source input is the fixed
`mcpatch.pack.json` file in the selected directory. Synthetic documents and
expected results live inside that file as inert JSON.

Build the CLI in this repository and optionally link its `mcpatch` executable:

```sh
pnpm --filter @mcpatch/cli build
pnpm --dir packages/cli link --global
```

For an unlinked checkout, replace `mcpatch` below with
`node packages/cli/dist/index.js` from the repository root.

## Workflow

```sh
mcpatch pack create ./my-pack
mcpatch pack validate ./my-pack
mcpatch pack test ./my-pack
mcpatch pack inspect ./my-pack
git -C ./my-pack add mcpatch.pack.json README.md package.json
git -C ./my-pack commit -m "feat: add my pack"
mcpatch pack build ./my-pack
mcpatch pack submit ./my-pack
```

`create` refuses an existing target rather than mixing generated files with an
unknown directory. The generated source contains one closed read tool, one inert
synthetic document, one expected result, and package scripts for the remaining
commands.

`validate` applies strict duplicate-key JSON decoding plus the canonical manifest,
the selected Declarative Operations version, schema, compatibility, permission, and bundle-content
validators. Errors contain only a stable code and static field; rejected fixture
values are not copied into output.

`test` executes every synthetic fixture through browser-free declarative read or
typed URL-construction semantics
and then checks the result with the declared output schema and exact expectation.
It requires no authenticated site, browser, Playwright process, or network access.

`inspect` prints the exact origins and paths, compatibility range, network policy,
tool names, risks, and permissions. It does not print fixture documents or expected
results.

`build` requires `mcpatch.pack.json` to be tracked and unchanged in Git. The exact
commit is placed in `metadata.sourceCommit`, and canonical bytes are written to
`dist/<publisher>.<id>-<version>.mcpack`. Rebuilding the same source and commit
reuses only byte-identical output. A different existing artifact, a symbolic or
non-file source, or a leftover staging file fails closed.

The `pack build` artifact is an `UNSIGNED_LOCAL_DEVELOPMENT` bundle-content artifact.
It cannot appear as reviewed or registry-signed. Import it only through the
extension's explicit [local developer mode](local-pack-developer-mode.md), which
shows its exact authority and retains the unsigned trust label; publisher signing
and submission remain separate workflows.

`pack submit` is the contributor release-preparation gate. It runs validation and
every synthetic fixture against an attributable commit, then atomically emits an
unsigned canonical artifact and payload-free authority report under
`submission-dist/`. The report includes selectors/operations and schemas but never
fixture documents, expected values, or results. See
[Contributing community packs](community-pack-contributions.md).

## Static registry publisher

Maintainers can build a reviewed static registry from already publisher-signed
bundles:

```sh
MCPATCH_REGISTRY_PRIVATE_KEY=... \
MCPATCH_REGISTRY_PUBLIC_KEY=... \
mcpatch registry build ./registry-source
```

The fixed input is `registry-source/mcpatch.registry.json`. Bundle paths must stay
beneath that directory and cannot traverse or use symbolic links. The source pins
the registry ID, publication sequence, issue/expiry window, publisher public key,
trust tier, fixture evidence, source commit, and revocation state for every bundle.
Private keys are environment-only.

The command verifies each publisher signature, digest, compatibility range,
identity, fixture count, and source commit before signing independent registry
attestations and the index. It writes `registry-dist/v1/index.json`, immutable
digest-addressed bundle paths, and static hosting headers atomically. A second run
reuses only byte-identical output; changed or partial output fails closed. See
[Community registry v1](architecture/community-registry-v1.md).

Actual reviewed releases use `mcpatch registry publish` with source version 2. It
requires clean registry and source checkouts, reproduces the bundle and review
report, re-runs fixtures, verifies the separate publisher signature, and only then
applies registry attestation. See
[Community registry publishing](registry-publishing.md).

## Source contract

The top level is closed and versioned by `sourceVersion: 1`. It contains pack
identity, compatibility, exact origin/path matches, license metadata, and tools.
Every tool explicitly declares `risk: "read"`, `permissions: ["READ"]`, a closed
empty input schema, a closed object output schema, availability, scope, projection,
and one or more synthetic fixtures. Runtime code, callbacks, JavaScript expressions,
URLs to fetch, browser objects, credentials, and filesystem references have no
source fields and are rejected.

Run the complete local CLI gate with:

```sh
pnpm verify:cli
pnpm verify:community-pack ./my-pack
```
