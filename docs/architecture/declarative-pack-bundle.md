# Declarative Pack Bundle v1

Declarative Pack Bundle v1 is an artifact contract independent from product
SemVer, bridge protocol, Pack Manifest, and Declarative Operations versions. A
runtime artifact is one UTF-8 JSON document with the .mcpack suffix. It is not
an archive, filesystem package, module, script, WebAssembly binary, or function
container.

The closed top-level shape is:

```json
{
  "bundleVersion": 1,
  "manifest": "Pack Manifest v1",
  "operations": {
    "operationsVersion": "1 or 2",
    "program": "the matching Declarative Operations program"
  },
  "metadata": {
    "license": "MIT",
    "homepage": "https://example.test/pack",
    "sourceCommit": "40-to-64 lowercase hex characters"
  },
  "publisherSignature": {
    "signatureVersion": 1,
    "algorithm": "Ed25519",
    "publisher": "example",
    "keyId": "ed25519:example:sha256:<64 lowercase hex>",
    "publicKey": "<unpadded base64url, 32 decoded bytes>",
    "signature": "<unpadded base64url, 64 decoded bytes>"
  }
}
```

registryAttestation may appear as a separate, optional envelope. It is not
part of the publisher signature or content digest. Its trust root, domain,
identity, digest, key identifier, publication sequence, issued/expiry times, and
review state are independently checked by the registry client. Registry
high-water and rollback policy belongs to the registry issues, not this artifact
contract.

The attestation shape is closed and contains `attestationVersion`, `registryId`,
`keyId`, publisher/pack identity, `bundleDigest`, a positive
`publicationSequence`, `reviewState` (`OFFICIAL` or `REVIEWED_COMMUNITY`),
canonical millisecond UTC timestamps, and a strict 64-byte Ed25519 signature.
Verification requires the expected registry identity supplied by the caller;
the attestation cannot select its own trust root.

## Canonical bytes and digest

All canonical bytes use RFC 8785 JSON Canonicalization Scheme (JCS). Object
members are sorted by UTF-16 code units, array order is significant, numbers are
safe integers only, and strings are preserved exactly: NFC and NFD are distinct.
Strings must be well-formed Unicode and must not contain Unicode noncharacters.
No normalization or case folding is performed.

The content payload is exactly:

```json
{
  "bundleVersion": 1,
  "manifest": "<manifest with its digest member omitted>",
  "metadata": "<metadata>",
  "operations": "<operations>"
}
```

The digest is:

```text
sha256(
  UTF-8("MCPatch declarative pack bundle digest\0bundle=1\0")
  || UTF-8(JCS(content payload))
)
```

The resulting lowercase sha256: value is placed in manifest.digest. The
publisher signature covers the following complete statement, which includes the
digest but excludes both signature envelopes:

```text
UTF-8("MCPatch declarative pack bundle signature\0bundle=1\0")
|| UTF-8(JCS({ "digest": manifest.digest, "payload": content payload }))
```

This digest-free projection is the only omission and prevents a circular digest.
The full .mcpack document is still serialized canonically, including its
signature and optional registry attestation.

The SDK uses the small pinned browser-safe canonicalize 2.1.0 package for JCS.
Duplicate-key rejection happens in the byte decoder before ordinary object
semantics can discard evidence. Consumers must use
parseDeclarativePackBundleBytes at artifact boundaries; JSON.parse alone is not
an acceptable signed-bundle decoder. Security verification APIs accept only the
serialized UTF-8 document (`string` or `Uint8Array`) and perform this strict
parse internally.

## Bounds and errors

The complete serialized document is limited to 1 MiB, with at most 32 JSON
levels, 8,192 nodes, 512 array elements per array, 256 object members per
object, and 16,384 Unicode code points per string. The complete serialized
artifact limit is measured in UTF-8 bytes. Fatal UTF-8 decoding is required.
Duplicate keys, escaped duplicate
names, truncation, invalid JSON, unknown fields, unknown versions, noncharacters,
lone surrogates, unsafe numbers, and negative zero fail closed.

Errors contain only a stable code and static field name. Rejected values, signatures,
keys, fixture data, and exception messages are never copied into an error.
Validated objects are detached and deeply frozen.

The JSON Schema `maxLength` values use the same Unicode code-point definition
as the SDK's `MAX_BUNDLE_STRING_CODE_POINTS` limit. Schema validation does not
replace the SDK's aggregate 1 MiB serialized-byte check; object APIs apply that
same aggregate check before digesting or signing.

The checked-in `packages/sdk/fixtures/v1/canonical-vector.json` is a compact
cross-runtime JCS acceptance vector. Its canonical UTF-8 bytes, SHA-256 digest,
and Ed25519 signature are asserted as fixed hex goldens in the SDK tests.

## Publisher keys and registry trust

Publisher signatures use Ed25519 with raw 32-byte public keys and 64-byte
signatures encoded as strict unpadded base64url. keyId is derived from the raw
public key and publisher namespace:

```text
ed25519:<publisher>:sha256(SHA-256(raw public key))
```

Verification requires a caller-supplied trusted-key lookup. The embedded
publicKey is evidence to compare with that lookup, not a trust root. Changing
the publisher, pack ID, version, manifest authority, operations, metadata,
digest, key, or signature invalidates verification. A publisher signature does
not establish registry review, revocation, freshness, or browser-origin
authority.

When present, `metadata.homepage` is a canonical HTTPS UI link: its DNS host is
lowercase ASCII, and it has no credentials, fragment, explicit port, or
non-canonical origin slash. It is display metadata and never grants navigation
or network authority.

Ed25519 uses the pinned @noble/ed25519 3.0.0 implementation because the
extension's current Chrome 106 floor predates portable native WebCrypto Ed25519.
The verifier still requires the platform Web Crypto SHA-256 primitive used for
content and key identifiers; future extension minimum changes must be recorded
explicitly rather than silently depending on a newer browser.

## Compatibility and migration

The contained manifest must be Pack Manifest v1 and declarative. Bundle version
and operations version are independent; this bundle revision accepts Operations
v1 (read-only) and v2 (v1 reads plus typed approved same-origin navigation), and
requires the manifest, operations envelope, and program versions to agree.
Unknown combinations are rejected. Runtime and bridge compatibility use the manifest's
closed-open runtime interval and closed bridge integer interval and are checked
before installation. Both operations versions retain
`networkPolicy.extensionRequests: none`; navigation does not grant request or
credential authority.

Compatible metadata or validation hardening may ship without changing the bundle
version. Any changed accepted meaning, digest projection, signature domain,
authority, compatibility semantics, or operations interpretation requires a new
bundle version and migration note. Deterministic rebuild evidence belongs in
metadata.sourceCommit; source-only fixtures and documentation are not runtime
artifact inputs unless they are represented in the signed operations/manifest
content.

The fixed program contract is documented in
[Declarative Operations](declarative-operations.md). It is the only location
for the canonical read-only AST; there is no archive path, module, script, or
second program file.
