# Contributing community packs

Community packs are reviewed data, not downloaded extension code. A contribution
must contain one declarative `mcpatch.pack.json`, synthetic fixtures, documentation,
and a changelog entry. It must not contain JavaScript handlers, captured traffic,
browser profiles, credentials, cookies, tokens, screenshots, copied page dumps, or
real user/account data.

## Author workflow

Start in an empty directory:

```sh
mcpatch pack create ./example-reader
cd ./example-reader
git init
git add .
git commit -m "feat: add example reader pack"
mcpatch pack submit .
```

`pack submit` validates the closed source format, executes every invented fixture,
attributes the source to an exact clean Git commit, and atomically writes:

- an unsigned canonical `.mcpack` content artifact; and
- a `.review.json` report containing identity, digest, compatibility, exact
  origins/paths, selectors and operations, schemas, risks, permissions, network
  policy, and fixture case IDs/statuses.

The report deliberately excludes fixture documents, expected values, and runtime
results. It is suitable for review logs but remains untrusted input. Tool names,
descriptions, labels, selectors, fixtures, homepage links, and marketplace metadata
can all be deceptive and must be checked against the source and intended site.

The artifact is not signed and cannot be published directly. Re-running the command
reuses only byte-identical output. Delete `submission-dist/` deliberately before
preparing a changed version; never edit generated files.

## Required review evidence

A pack pull request must identify its publisher owner and include:

- the exact source commit and generated digest;
- a SemVer version and user-visible changelog entry;
- one or more wholly invented fixtures for every tool;
- the tested runtime and bridge compatibility range;
- the exact supported HTTPS origins and path rules;
- every schema, selector/operation, risk, permission, and network policy;
- local `pnpm verify:community-pack <pack-directory>` output; and
- compatibility evidence that contains no page payload or user data.

Updates must call out changes to origin, path, operation, schema, permission, risk,
compatibility, publisher identity, and digest. Authority expansion is never implied
by a version bump and requires explicit maintainer review.

## Ownership and fixture policy

The publisher namespace owner is accountable for source changes and publisher-key
custody. Repository CODEOWNERS determine MCPatch review; a publisher cannot approve
its own registry attestation. At least one independent maintainer reviews normal
changes, and authority expansion or key/identity changes require a second explicit
security review.

Fixtures must be small, synthetic, deterministic, and licensed for inclusion. Use
invented labels, identifiers, prices, posts, and account names. Do not sanitize a
real session capture and submit it—the original data must never enter the repository
or review artifact. Tests run without a browser or network connection.

## Maintainer review

Review the source rather than trusting generated prose. Verify the selector scope,
bounded cardinality, projection, schemas, compatibility, origin/path rules, and the
absence of hidden authority. Re-run the contributor gate from the exact commit and
compare both generated files byte-for-byte. Publication follows the separate
[registry publishing procedure](registry-publishing.md).
