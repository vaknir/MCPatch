# Community pack lifecycle and trust

This document defines the product state machine for community declarative packs.
It applies to the future signed registry and to local unsigned development mode;
it does not change the existing reviewed compiled-pack catalog.

## Trust tiers and authority

Trust is an installed-pack property, not a star rating or a publisher claim. The
identity used by every runtime and storage record is the tuple
`publisher`, `id`, `version`, and `digest`, together with the trust tier and the
signing/attestation records that established it.

| Tier                         | Artifact source                                                                                           | Who may publish/sign                                                                                                   | Who reviews                                                                             | Install and enable                                                                     | Revoke                                                                                                                             | Local override                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `OFFICIAL`                   | MCPatch-maintained declarative bundle, or an existing compiled pack in a reviewed extension release       | The separated MCPatch release authority; registry publication is signed separately                                     | MCPatch maintainers, with a second reviewer for authority changes                       | The user, through the extension-owned review flow                                      | Emergency MCPatch security authority, with an auditable signed record                                                              | Never in place; a modified copy is a new unsigned local identity                         |
| `REVIEWED_COMMUNITY`         | A publisher-signed declarative bundle and a registry entry with an independent MCPatch review attestation | The enrolled publisher signs the exact bundle; the registry publisher signs index membership, not executable authority | An independent MCPatch reviewer records compatibility, authority, and security evidence | The user, after inspecting the extension-owned review and granting the selected origin | Emergency MCPatch security authority can revoke the attestation or artifact; the publisher cannot silently revoke another identity | Never in place; local testing uses a distinct unsigned identity                          |
| `UNSIGNED_LOCAL_DEVELOPMENT` | A user-selected local declarative bundle                                                                  | No signing authority; the local user controls the file                                                                 | No registry review; the developer is responsible for the local artifact                 | The user explicitly opts into developer mode and then grants the selected origin       | The user, extension restart reconciliation, or any validation/permission failure                                                   | Replacement is allowed only after a new digest confirmation and remains visibly unsigned |

Publisher display names, links, descriptions, logos, tool titles, and review
summaries are untrusted presentation data. They never establish identity, resolve
collisions, or override a signature, digest, compatibility result, permission, or
revocation record. A publisher key rotation or transfer creates an auditable new
identity relationship; it does not make old bytes newly trusted.

The registry may accept submissions, but submission is not publication. Only the
separated registry signing authority can add a reviewed entry to the signed index.
Only the user can install or enable a pack on a browser origin. Maintainers cannot
push an enablement, replace active bytes, or grant browser host authority remotely.

## Persistent identity and browser grants

The installed record is closed and attributable:

```text
installed = {
  trustTier, publisher, id, version, bundleDigest, operationsVersion,
  compatibility, matches, permissions, networkPolicy, verificationState
}
```

An enabled-origin record contains the complete installed identity plus the exact
canonical origin and matched path. It is not keyed by origin alone. A Chromium
host permission is origin-wide, so the browser grant itself cannot distinguish two
packs; MCPatch therefore treats it as necessary but insufficient proof. Every
capability publication and call must find a matching enabled record for the exact
pack identity, exact origin/path, current digest, compatible operations version,
and current permission state. Removing one pack does not remove a shared browser
grant until no remaining enabled record needs it.

An unsigned local identity is generated in a local-only namespace and can never
equal an official or community `publisher/id` pair. Importing the same bytes does
not permit a local record to replace a signed record. A changed digest, manifest,
operation, schema, origin/path, risk, permission, or trust tier is a new candidate
and requires explicit confirmation.

## State machine

The registry and installer keep candidate state separate from active authority.
The following states are user-visible where they can affect an install decision:

```text
DISCOVERED → REVIEW_PENDING → INSTALLED_CANDIDATE → ENABLE_PENDING
                                  │                       │
                                  │                       ├─ permission denied → DISABLED
                                  │                       └─ exact grant + reconciliation → ACTIVE
                                  └─ user install → ENABLE_PENDING

ACTIVE → DISABLED → ENABLE_PENDING → ACTIVE
ACTIVE → UPDATE_AVAILABLE → INSTALLED_CANDIDATE → ENABLE_PENDING → ACTIVE
ACTIVE → REVOKED | INCOMPATIBLE | STALE | UNINSTALLED
```

- `DISCOVERED` is metadata only. It cannot publish tools or request host access.
- `REVIEW_PENDING` shows the exact selected bundle and authority before any
  permission request. The user must accept the trust tier, publisher signing
  identity, version, digest, origin/path, tools, schemas, risks, permissions,
  network policy, compatibility, and freshness/revocation status.
- `INSTALLED_CANDIDATE` is verified data held for a possible activation. It has no
  page script, browser-origin authority, or live capability.
- `ENABLE_PENDING` is the short period during which the user gesture requests the
  exact selected origin and MCPatch validates the returned grant.
- `ACTIVE` requires verified bytes, a compatible runtime, a non-revoked fresh
  record, an enabled identity record, a current exact browser permission, a
  registered packaged declarative runtime, a successful page handshake, and a
  negotiated bridge session.
- `DISABLED` retains no live contexts. It may retain a verified inactive artifact
  for an explicit later enablement.
- `UPDATE_AVAILABLE` is a candidate notification only. It cannot alter active
  routes. Changed authority or executable operations always require a new review.
- `REVOKED`, `INCOMPATIBLE`, and `STALE` are deny states. Existing contexts and
  pending calls are revoked before cleanup; no automatic downgrade or fallback is
  allowed.
- `UNINSTALLED` removes the installed and enabled records and managed script. A
  browser origin grant is removed only when no remaining MCPatch pack requires it;
  all MCPatch authority is already gone before that asynchronous cleanup.

Install, update, and uninstall are transactional from the authority perspective:
stage and validate first, publish no live capability until all checks pass, and
revoke before deleting or replacing anything. An interrupted operation resumes as
disabled/candidate state, never as guessed active state.

## Freshness, offline, and revocation

The signed index has a bounded issue/expiry interval and a monotonic publication
sequence. The selected bundle digest and identity are verified independently of
the index. A cache may be used offline only when it was previously verified,
unexpired for runtime use, compatible, and not locally marked revoked. Offline
operation is clearly marked with the last verified registry sequence and time; it
does not allow new discovery, installation, or update from an unverified record.

When the freshness deadline passes without a successful revocation check, MCPatch
revokes new and existing community contexts and reports `STALE`. It does not guess
that an unavailable registry means safe. Invalid signatures, digest mismatch,
rollback sequence, expired metadata, malformed content, incompatible runtime or
operations version, duplicate identity, ambiguous matching pack, permission loss,
and failed script registration all fail closed. A revoked current or rollback
artifact cannot be restored by offline mode.

## Existing behavior preserved

Native WebMCP remains the first capability source. An eligible native tool wins an
identical community or compiled-pack name; an ambiguous native set hides the name.
The existing reviewed compiled packs remain extension-bundled, separately
reviewed, and governed by their current exact-origin enablement. Community metadata
cannot replace, shadow, or change a compiled definition. The declarative interpreter
is packaged code and receives only the validated operation data for the one active
pack; it has no generic browser, cookie, storage, raw DOM, or arbitrary network
primitive.

## Follow-up implementation issues

The implementation is intentionally split across the dependency-ordered issues:
[bundle and signing semantics #143](https://github.com/vaknir/MCPatch/issues/143),
[operations #144](https://github.com/vaknir/MCPatch/issues/144),
[interpreter #145](https://github.com/vaknir/MCPatch/issues/145),
[SDK #146](https://github.com/vaknir/MCPatch/issues/146),
[CLI #147](https://github.com/vaknir/MCPatch/issues/147),
[unsigned developer mode #148](https://github.com/vaknir/MCPatch/issues/148),
[exact-origin enablement #149](https://github.com/vaknir/MCPatch/issues/149),
[signed registry #150](https://github.com/vaknir/MCPatch/issues/150),
[updates and revocation #151](https://github.com/vaknir/MCPatch/issues/151),
[submission and publishing #152](https://github.com/vaknir/MCPatch/issues/152),
[declarative actions #153](https://github.com/vaknir/MCPatch/issues/153), and
[pilot validation #154](https://github.com/vaknir/MCPatch/issues/154).
