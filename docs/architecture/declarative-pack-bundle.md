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
  "operations": { "operationsVersion": 1, "program": "opaque JSON" },
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
an acceptable signed-bundle decoder.

## Bounds and errors

The complete document is limited to 1 MiB, with at most 32 JSON levels, 8,192
nodes, 512 array elements per array, 256 object members per object, and 16 KiB
per string. Fatal UTF-8 decoding is required. Duplicate keys, escaped duplicate
names, truncation, invalid JSON, unknown fields, unknown versions, noncharacters,
lone surrogates, unsafe numbers, and negative zero fail closed.

Errors contain only a stable code and field path. Rejected values, signatures,
keys, fixture data, and exception messages are never copied into an error.
Validated objects are detached and deeply frozen.

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

Ed25519 uses the pinned @noble/ed25519 3.0.0 implementation because the
extension's current Chrome 106 floor predates portable native WebCrypto Ed25519.
The verifier still requires the platform Web Crypto SHA-256 primitive used for
content and key identifiers; future extension minimum changes must be recorded
explicitly rather than silently depending on a newer browser.

## Compatibility and migration

The contained manifest must be Pack Manifest v1, declarative, and use
operationsVersion: 1. Bundle version and operations version are independent;
unknown values are rejected. Runtime and bridge compatibility use the manifest's
closed-open runtime interval and closed bridge integer interval and are checked
before installation. Version 1 is read-only by contract through
networkPolicy.extensionRequests: none; actions and network authority require
later separately reviewed contracts.

Compatible metadata or validation hardening may ship without changing the bundle
version. Any changed accepted meaning, digest projection, signature domain,
authority, compatibility semantics, or operations interpretation requires a new
bundle version and migration note. Deterministic rebuild evidence belongs in
metadata.sourceCommit; source-only fixtures and documentation are not runtime
artifact inputs unless they are represented in the signed operations/manifest
content.
