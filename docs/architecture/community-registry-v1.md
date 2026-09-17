# Community registry v1

MCPatch community distribution is a static, signed control plane. It distributes
bounded declarative data; it cannot distribute extension code, choose a URL at
runtime, grant browser authority, or invoke a tool. The extension trusts one
compiled-in HTTPS origin, registry identity, and Ed25519 public key.

## Published layout

```text
/v1/index.json
/v1/bundles/<publisher>/<pack>/<version>/<content-sha256>.mcpack
```

The index media type is `application/vnd.mcpatch.registry-index+json`. Bundle
objects use `application/vnd.mcpatch.pack+json`. The index is `no-store`; bundle
objects are immutable. Redirects, content-type parameters, partial responses,
empty bodies, inconsistent `Content-Length`, oversized streams, non-200 status,
and a final response URL different from the requested fixed URL are rejected.
Requests omit credentials and referrers and use a ten-second deadline.

The closed [JSON Schema](../../packages/sdk/schema/v1/community-registry-index.schema.json)
documents index v1. Runtime validation is stricter: it also requires canonical
timestamps and origins, sorted unique publisher/pack/version releases, bounded
version history, sorted unique origins/tools, a digest-derived
bundle path, matching attestation fields, compatible read-only declarative packs,
and all-successful fixture evidence.

## Independent proofs

Installation requires all of these independent checks:

1. The index signature verifies against the compiled registry key and expected
   registry ID.
2. Its positive publication sequence is at least the local high-water mark, its
   issue time is not in the future, and its expiry is still live.
3. The selected entry has an active revocation record and a valid registry
   attestation over its exact identity, digest, trust tier, sequence, and freshness
   window.
4. The immutable bundle verifies against the entry's enrolled publisher key.
5. Bundle identity, digest, display metadata, exact origins, tool summaries,
   compatibility, network policy, and source commit equal the signed index entry.
6. The complete declarative bundle passes the packaged MCPatch validator for the
   current runtime and bridge protocol.

TLS is transport confidentiality and server authentication, not pack trust. A
registry signature does not replace the publisher signature, and neither signature
grants a browser host permission.

## Discovery and installation

Discovery runs only from an explicit MCPatch action on the browser-provided current
tab. The extension fetches or verifies the index, matches the current canonical URL
locally, downloads and verifies exactly one candidate, and persists a short-lived
candidate before opening `community-review.html`. No current page URL or installed
origin inventory is sent to the registry.

The extension-owned review renders the publisher key, registry key ID, identity,
version, digest, exact origin/path rules, schemas, risk, permissions, network
policy, compatibility, source commit, fixture evidence, sequence, and expiry using
text-only DOM APIs. Its confirmation click requests only the already staged exact
origin patterns as the first asynchronous operation in that trusted gesture. A
denial or a broader/missing permission leaves the candidate inactive.

Installed bytes, the signed index, and its high-water sequence live in
trusted-context-only extension storage. Startup re-verifies every cryptographic and
semantic proof from bytes. A valid fresh cached artifact may run offline and is
shown as cached; expiry, corruption, incompatibility, permission loss, or an invalid
record revokes authority before script cleanup. Explicit updates, one bounded
rollback, interrupted-activation recovery, and revoke-before-cleanup behavior are
defined in [community pack updates](community-pack-updates.md).

## Static publisher

`mcpatch registry build <directory>` reads only `mcpatch.registry.json` and local
publisher-signed `.mcpack` files beneath that directory. It performs no network or
browser access. The source declares fixed issue/expiry times, a monotonic sequence,
enrolled publisher keys, trust tiers, fixture evidence, source commits, and
revocation records. Registry keys are accepted only from
`MCPATCH_REGISTRY_PRIVATE_KEY` and `MCPATCH_REGISTRY_PUBLIC_KEY`; they are never
written or included in command output.

The command re-verifies every publisher signature and content digest, rejects
symlinks and escaping paths, canonicalizes signed bundles, creates independent
registry attestations, signs the bounded index, and atomically writes
`registry-dist`. Existing output is reused only when the entire tree is byte-for-byte
identical; any difference fails as dirty output. `_headers` records the required
static media types and cache policy.

Reviewed release publication uses source format v2 and
`mcpatch registry publish <directory>`. It additionally requires clean registry and
pack repositories, rebuilds the exact source commit, re-runs fixtures, and compares
the generated payload-free review report before calling the same deterministic
publisher. Contributor output remains unsigned and cannot invoke registry signing.
The complete source layout, protected-key boundary, rotation, transfer, and
revocation procedure is in [registry publishing](../registry-publishing.md).

The checked-in production public key is a pre-release trust root whose private key
is not in this repository. Production ceremony and emergency operation remain
release work under issue #166; the deterministic local ceremony and rotation
procedure are implemented under issue #152.

## Version and bounds

- Index version: `1`
- Registry signature version: `1`
- Maximum index body: 1 MiB
- Maximum entries: 256
- Maximum versions per publisher/pack identity: 3
- Maximum installed community packs: 4
- Maximum origins per entry: 16
- Maximum summarized tools per entry: 64
- Candidate lifetime: 5 minutes

Unknown fields and unsupported versions fail closed. Product SemVer, Pack Manifest
version, Declarative Operations version, bridge protocol, and registry index version
remain separate compatibility axes.
