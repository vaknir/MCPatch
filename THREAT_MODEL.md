# MCPatch threat model

- Status: Initial foundation model
- Updated: 2026-09-16
- Review trigger: any new transport, permission, pack distribution path, trust-tier
  change, write tool, or credential-handling feature

## Security objective

An untrusted MCP caller may invoke only the exact website capabilities a user has
enabled and policy permits, without receiving browser authentication material or a
general-purpose path to control the browser.

## Protected assets

- browser cookies, tokens, credentials, and authenticated session state;
- private website content visible to the user;
- the ability to act as the user on a website;
- approval decisions and one-time grants;
- pack identity, integrity, and enabled-origin configuration;
- bridge and extension integrity;
- audit metadata that must remain useful without containing sensitive content; and
- local machine availability and user-scoped IPC integrity.

## Actors and inputs

The following are always untrusted:

- MCP clients, agents, models, and tool arguments;
- website DOM, scripts, events, text, and native WebMCP metadata;
- pack manifests, schemas, fixtures, implementation input, and marketplace data;
- publisher claims, publisher keys, registry attestations, cached indexes, and
  revocation metadata;
- tool results before validation;
- bridge and extension messages before authentication and validation; and
- files, environment values, and local IPC peers not created by the trusted install.

A pack is executable code. It becomes trusted only for the exact immutable version,
publisher, origins, permissions, and runtime policy that the user installed and
enabled. Popularity or marketplace presence does not confer trust.

## Trusted computing base

- the installed MCPatch bridge binary and native-host manifest;
- the installed MCPatch extension package and fixed production extension identity;
- deterministic policy, schema validation, and canonicalization code;
- the packaged declarative operation interpreter and its bounded page adapter;
- operating-system user isolation and browser extension isolation;
- explicitly trusted pack signing keys and immutable installed pack bytes; and
- the user making an approval decision in trusted MCPatch UI.

The registry is outside the runtime trusted computing base. It may distribute signed
artifacts and evidence, but runtime verification, trust-tier assignment, revocation
handling, and explicit enablement are local. A publisher signature proves control of
keyed bytes; it does not prove that MCPatch reviewed the authority.

## Assumptions

- The operating system and browser enforce process, file, extension, and user
  isolation correctly.
- The MCP client may be buggy or hostile but cannot already execute arbitrary code
  as the same OS user outside its configured server process.
- The user can identify trusted MCPatch approval UI; page-controlled UI is not an
  approval surface.
- Cryptographic primitives and platform random number generation are sound.
- A compromised trusted binary, extension, signing key, or OS is outside prevention
  scope, though revocation and recovery must eventually be supported.

## Boundaries and data flow

```text
untrusted MCP caller
        │ validated MCP request
        ▼
Rust bridge: schema, registry, policy, approval, routing
        │ authenticated and versioned MCPatch message
        ▼
extension service worker: connection, context, pack dispatch
        │ bounded page protocol over browser-authenticated document port
        ▼
content script / native WebMCP / installed trusted pack
        │ browser-mediated access
        ▼
untrusted website in an authenticated browser session
```

Data returning upward crosses the same boundaries and is validated and bounded at
each one. Raw credentials have no valid upward representation.

## Threats and required mitigations

### Capability confusion and confused deputy

An attacker reuses a tool name in another tab, origin, pack, or connection, or
causes a stale registration to route to a new page.

Mitigations:

- key registrations by authenticated connection and opaque context ID;
- bind each capability to exact normalized origin and immutable pack identity;
- replace complete context snapshots atomically;
- make naming collisions deterministic, with native WebMCP precedence;
- revoke on navigation, tab close, disable, disconnect, and origin change; and
- recheck context and origin immediately before dispatch.

### Argument and schema smuggling

Different parsers interpret duplicate, unknown, oversized, deeply nested, or
non-canonical input differently, bypassing policy or approval hashes.

Mitigations:

- one JSON Schema 2020-12 contract and shared malformed fixtures;
- closed protocol objects and strict message discriminators;
- reject duplicate JSON keys at boundary parsers where the parser permits it;
- bound bytes, nesting depth, collection sizes, strings, schemas, and validation
  time;
- validate tool input before policy evaluation; and
- use one documented canonical JSON algorithm for approval hashing.

### Approval substitution, replay, and race

An agent changes arguments after approval, reuses a grant, races two calls, or
navigates the tab before execution.

Mitigations:

- grants bind tool, normalized origin, context, canonical argument hash, expiry,
  policy version, and a random nonce;
- consume a grant atomically before dispatch with `uses = 1`;
- never accept approval from page content or MCP/model text;
- deny elevated calls until extension/native trusted UI can present exact
  human-readable fields through a separate bounded presentation contract;
- recheck context and origin at dispatch; and
- fail closed on clock uncertainty, storage error, or state mismatch.

### Credential and private-data exfiltration

A site, pack, caller, or malformed result attempts to return credentials, hidden
page data, or excessive content through tool output, errors, or logs.

Mitigations:

- no cookie or credential APIs in the pack context;
- expose task-specific DOM adapters instead of a document handle where practical;
- require output schemas and byte limits;
- use allowlisted structured log fields with opaque identifiers;
- never log raw arguments, results, page text, grants, or transport frames; and
- classify tools that can read sensitive page content as `SENSITIVE` even if they
  do not mutate state.

Content-level secret detection can reduce accidents but is not the primary boundary;
the capability API must make credential access unavailable.

### Malicious or compromised pack

A pack requests broad origins, reads unrelated content, performs hidden network
requests, changes behavior after review, or impersonates another publisher.

Mitigations:

- install immutable, signed bundles; never execute registry-hosted code directly;
- bind identity to publisher key, pack ID, version, and content digest;
- validate exact origins, permissions, runtime compatibility, and network policy;
- request optional host permission only when a user enables a pack;
- dynamically register only the enabled origin's top-level isolated content bundle;
- isolate pack APIs and deny ambient cookies, arbitrary fetch, and extension APIs;
- require media-producing tools to define a reviewed semantic capture scope and
  enforce shared MIME, dimension, count, and decoded-byte limits at every boundary;
- make permission increases an explicit reinstall/reapproval event; and
- maintain revocation and local disable controls before a public marketplace.

The community design admits only bounded declarative data to the packaged
interpreter. `OFFICIAL`, `REVIEWED_COMMUNITY`, and `UNSIGNED_LOCAL_DEVELOPMENT`
are separate trust tiers, and unsigned local identities cannot collide with signed
publisher/pack identities. Third-party code is still never downloaded or executed.

### Malicious publisher and dependency confusion

A publisher impersonates a popular pack, reuses another publisher's ID, transfers
an ID without proof, or supplies a local bundle that looks like a reviewed release.

Mitigations:

- bind trust to publisher key, publisher/pack ID, version, digest, and tier rather
  than display name, logo, link, or popularity;
- require publisher proof and independent MCPatch registry attestation for trusted
  tiers, with separated signing and review roles;
- make unsigned development identities use a local-only namespace that cannot equal
  an official or reviewed-community identity;
- reject cross-publisher replacement, identity reuse, ambiguous duplicate records,
  and key/transfer changes without an explicit verified relationship; and
- preserve visible trust and signing history through updates and revocation.

### Compromised registry metadata or bundle delivery

An attacker controls an index, cache, CDN object, redirect, content type, or
publisher-facing metadata and attempts substitution, truncation, rollback, stale
replay, or silent authority expansion.

Mitigations:

- fetch only bounded objects from the fixed MCPatch registry origin with no
  credentials and no caller-selected URL or redirect;
- verify index and bundle signatures, digest, identity, content type, size,
  publication sequence, compatibility, and revocation locally before presentation;
- keep registry control-plane traffic separate from pack `EXTERNAL_NETWORK`
  authority; community read-only packs cannot invoke it;
- stage candidates separately from active bytes and require explicit review for any
  digest or authority change; and
- reject invalid, conflicting, rolled-back, or partial records before installation.

### Stale packs and revocation gaps

An installed pack is used after the registry has revoked it, after compatibility has
expired, or while the client is offline and cannot learn of an emergency event.

Mitigations:

- bind active use to a signed freshness deadline and a verified unrevoked record;
- allow offline use only for a previously verified, compatible, fresh artifact and
  show the last verification sequence/time;
- when freshness expires, revoke existing community contexts and deny new calls;
- apply a verified revocation to current and rollback candidates before script or
  storage cleanup; and
- never treat a stale cache, failed network request, or browser grant as evidence of
  continued safety.

### Deceptive schemas and marketplace metadata

A pack uses friendly descriptions, titles, schemas, fixtures, or labels to hide a
dangerous read, an unexpected origin, sensitive fields, or a confusing action from
the user or reviewer.

Mitigations:

- derive policy from locally validated manifest fields and operation semantics, not
  descriptions, annotations, or page text;
- show exact origins/paths, schemas, risk, permissions, network policy, publisher
  key, digest, compatibility, and verification state before host permission;
- require closed schemas and fixed declarative operations with no dynamic selectors,
  code, navigation, mutation, cookies, storage, or network primitive;
- treat fixture success and marketplace evidence as bounded, untrusted evidence;
  they do not grant authority; and
- fail closed on schema/operation mismatch, omitted fields, unsupported keywords,
  oversized or ambiguous data, and changes requiring re-review.

### Malicious website and prompt injection

A page instructs an agent to call dangerous tools or crafts DOM content that changes
tool metadata and policy.

Mitigations:

- treat page text and native tool descriptions as untrusted presentation data;
- resolve policy from locally accepted metadata, not descriptions or annotations;
- separate discovery from authorization;
- prevent page scripts from messaging the native host directly; and
- require deterministic approval for action and sensitive classes, while credential,
  external-network, and arbitrary-execution authority remains denied by local policy.

### Forged or stale page context

A page, subframe, stale document, or compromised content message attempts to own a
context, replace a newer document, or route a result after navigation.

Mitigations:

- accept only fixed-name ports created by the extension's top-level isolated-world
  content runtime;
- validate browser-attested extension ID, frame ID, tab ID, document ID, URL, and
  canonical HTTPS origin before protocol parsing;
- require the origin to have both an enabled reviewed pack and a current Chromium
  host permission;
- allow only one owner for an exact tab/document pair and assign monotonic context
  revisions in the service worker;
- bind page calls and responses to request, context, revision, origin, and tool;
- revoke pending calls and snapshots on port disconnect, permission removal, pack
  disablement, origin change, or bridge disconnect; and
- reconstruct no live page authority from persistent storage after a service-worker
  restart.

### Unauthorized native or local connection

A website, another extension, or another local user/process connects to the bridge
or injects frames.

Mitigations:

- exact Native Messaging `allowed_origins` and caller-origin verification;
- deterministic derivation of that origin from committed public identity only,
  with no environment override or repository signing secret;
- canonical direct binary invocation with no generated shell launcher, plus an
  integrity-bound ownership receipt for installation and removal;
- user-owned runtime directory and Unix socket mode, or Windows named-pipe ACL;
- per-install peer authentication if platform ownership is insufficient;
- bounded length-prefixed frames and mandatory protocol negotiation; and
- no unauthenticated localhost listener.

A malicious process already running as the same user remains a residual risk. A
future pairing protocol should add channel-bound, rotatable credentials stored in
platform-protected storage.

### Denial of service

A peer floods messages, registers many capabilities, sends pathological schemas,
or leaves calls pending.

Mitigations:

- hard frame and result size limits;
- per-connection limits for contexts, capabilities, and in-flight calls;
- schema complexity and validation-time limits;
- timeouts, cancellation, backpressure, and bounded queues;
- reject-before-allocate parsing where feasible; and
- terminate peers after repeated protocol violations.

### Supply-chain and update compromise

A dependency, build workflow, extension update, native installer, or signing key is
compromised.

Mitigations:

- lockfiles, minimal dependencies, automated advisories, and reviewed updates;
- CI tests, static analysis, and reproducible release provenance;
- least-privilege GitHub Actions permissions and pinned third-party actions;
- separate development and production extension/native-host identities;
- signed releases and pack bundles before external distribution; and
- key rotation and revocation procedures before the first public release.

## Permission classes

The policy vocabulary begins with these non-exclusive classes:

| Class                 | Meaning                                            | Default policy                                  |
| --------------------- | -------------------------------------------------- | ----------------------------------------------- |
| `READ`                | Reads bounded, task-specific visible state         | Enabled-pack policy may allow                   |
| `ACTION`              | Mutates website or account state                   | One-time approval                               |
| `SENSITIVE`           | Reads or changes private/high-impact data          | One-time approval                               |
| `CREDENTIAL`          | Accesses authentication material                   | Denied in normal runtime                        |
| `EXTERNAL_NETWORK`    | Contacts an origin outside the matched site policy | Denied unless explicitly installed and approved |
| `ARBITRARY_EXECUTION` | Evaluates code or performs generic automation      | Denied in normal runtime                        |

Risk labels shown to users are derived from permissions and reviewed metadata. They
do not replace enforcement.

Community declarative packs begin with `READ` only and
`networkPolicy.extensionRequests: "none"`. Declarative actions and external
network methods require their own future ADR and cannot be smuggled in through
registry metadata or a schema.

## Residual risks

- A trusted pack may contain a logic bug that returns more data than intended.
- A same-user malicious process may attack local IPC or bridge binaries.
- Browser extension isolation defects can invalidate the trust model.
- A user can approve a misleading but accurately displayed action.
- Website changes can cause a pack to select the wrong user-visible data.
- A registry outage or delayed revocation check leaves a fresh cached community
  artifact usable until its bounded freshness deadline.
- Chrome Web Store policy may reject the broad optional declaration needed to
  express arbitrary runtime-discovered HTTPS origins or may classify an overly
  expressive remote-data interpreter as remote logic; distribution must stop rather
  than weaken the runtime boundary.

Compatibility fixtures, publisher accountability, precise approval UX, and rapid
disable/revocation reduce these risks but do not eliminate them.

## Required security tests

Before the relevant feature can merge, tests must cover:

- denied and undeclared capability;
- mismatched or changed origin and context;
- expired, reused, and argument-modified approvals;
- malformed, oversized, unknown-version, and unknown-type messages;
- duplicate request identifiers and unauthorized local connections;
- navigation/disconnect revocation and cancellation races;
- forged, subframe, stale-document, and permission-revoked content ports;
- schema complexity and output-size limits; and
- redaction/absence of sensitive data in structured logs.
- signed index/bundle substitution, replay, rollback, duplicate identity, stale
  cache, revocation, and offline freshness behavior;
- trust-tier collisions, publisher key/transfer changes, deceptive metadata and
  schemas, and unsigned local replacement attempts; and
- exact-origin permission prompts, denial, permission loss, shared-origin record
  attribution, and absence of any broad runtime host grant.
