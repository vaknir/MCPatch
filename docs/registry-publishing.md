# Community registry publishing

Registry publication is a maintainer-only release operation. Contributor submission,
publisher signing, MCPatch review attestation, and user installation are separate
authorities. A submission cannot add itself to the registry.

## Publication source v2

`mcpatch registry publish <directory>` accepts a clean Git repository containing:

```text
mcpatch.registry.json
inputs/<publisher-signed>.mcpack
reviews/<generated>.review.json
sources/<reviewed checkout>/mcpatch.pack.json
```

The source checkout may be a pinned submodule or separate nested checkout. It must
be at the exact commit recorded by the signed bundle and verification record, have
no tracked or untracked changes, and ignore only its generated `dist/` and
`submission-dist/` directories. The registry repository must also be clean; its
generated `registry-dist/` may be ignored.

Each `registrySourceVersion: 2` pack entry adds `source` and `reviewReport` paths to
the v1 signed-bundle fields. Paths are relative, bounded, and cannot traverse or use
symbolic links. The command then:

1. verifies both repositories are clean and records their exact commits;
2. rebuilds the declarative bundle from the reviewed source commit;
3. re-runs every synthetic fixture without browser or network access;
4. reproduces and exactly compares the payload-free review report;
5. verifies publisher signature, publisher key, identity, version, digest,
   compatibility, fixture count, and source commit;
6. rejects duplicate identities and more than the bounded release history; and
7. signs independent registry attestations and the index with environment-only
   registry keys before atomically publishing immutable paths.

Run:

```sh
MCPATCH_REGISTRY_PRIVATE_KEY=... \
MCPATCH_REGISTRY_PUBLIC_KEY=... \
mcpatch registry publish ./registry-release
```

Private keys must come from the release environment and must never be written to a
source, report, artifact tree, command transcript, fixture, or CI variable dump.
`registry build` remains the lower-level deterministic v1 builder; release
publication must use `registry publish` and source version 2.

## Key rotation and pack transfer

Publisher key rotation is an identity event, not an in-place substitution:

1. publish a final release with the old key that names the planned rotation in its
   changelog and security review;
2. enroll and independently verify the new key out of band;
3. submit a higher pack version signed by the new key;
4. reproduce its exact source and require two maintainer approvals for the changed
   signing authority; and
5. retain old releases with their old keys until they age out or are explicitly
   revoked. Never rewrite their metadata.

Compromise skips the graceful first step: emergency-revoke every affected digest,
rotate the key, investigate source history, and publish no replacement until the new
authority is independently verified.

A pack transfer also requires a new publisher namespace and pack ID/version lineage.
Old publisher releases remain immutable and are marked `SUPERSEDED` only after the
new owner, key, source, compatibility, and authority have been reviewed. Registry
metadata must not silently map an old identity to a new owner.

Revocation changes only a new signed index record with a higher publication sequence,
canonical timestamp, and fixed reason (`SECURITY`, `PUBLISHER`, or `SUPERSEDED`).
Published bundle bytes and prior indexes are never mutated.

## Local and future hosted gate

Today, authoritative review evidence is produced locally because hosted GitHub
Actions credits are unavailable. Run the root formatting, lint, typecheck, test,
build, dependency-audit, Rust, and Chromium gates plus
`pnpm verify:community-pack <pack-directory>`.

When hosted CI is restored, invoke the same root script against the changed pack
directory in a network-disabled job. Do not replace it with a weaker parser-only
check, inject signing keys into pull-request jobs, or publish from untrusted forks.
Registry signing belongs in a protected release environment after review.
