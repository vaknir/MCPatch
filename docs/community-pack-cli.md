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
```

`create` refuses an existing target rather than mixing generated files with an
unknown directory. The generated source contains one closed read tool, one inert
synthetic document, one expected result, and package scripts for the remaining
commands.

`validate` applies strict duplicate-key JSON decoding plus the canonical manifest,
Declarative Operations v1, schema, compatibility, permission, and bundle-content
validators. Errors contain only a stable code and static field; rejected fixture
values are not copied into output.

`test` executes every synthetic fixture through the browser-free v1 read semantics
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

The Phase 13 build is an `UNSIGNED_LOCAL_DEVELOPMENT` bundle-content artifact.
It cannot appear as reviewed or registry-signed, and normal installation does not
accept it. The separate developer-mode issue owns explicit local import and trust
labeling; publisher signing and submission remain separate issues.

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
```
