# Jira Data Center session adapter

The third reviewed MCPatch real-site pack exposes the core Jira capability
surface of an MCP Atlassian server from inside the browser. It targets
self-hosted Jira Data Center and Jira Server deployments, where no Atlassian
Cloud API token exists and the user's existing authenticated session is the only
credential available.

Unlike the Google Flights and TradingView adapters, this pack reads almost
nothing from rendered markup. Jira publishes its own stable `ajs-*` document
metadata and a documented REST v2 API on the same origin, so the adapter reads a
small page envelope and then calls that API with the session the browser already
holds.

## Authority and activation

Jira Data Center is self-hosted, so the pack has no reviewable constant origin.
Pack Manifest v1 accepts exact HTTPS origins only, and the extension grants
authority only for an origin present in both `DECLARED_OPTIONAL_ORIGINS` and
`optional_host_permissions`. The shipped build therefore declares one synthetic
`.invalid` origin in `packs/jira/src/deployment.ts`: the pack is compiled,
validated, and fully tested, but contributes no site to the reviewed catalog and
can never become page authority.

An operator enabling one instance edits that deployment list and the extension
manifest together, then rebuilds. `apps/extension/tests/bundled-jira.test.ts`
fails if the two lists disagree. Runtime-selected origins, which would remove the
rebuild step, are the separate trust decision in
[ADR 0014](../adr/0014-registry-discovery-and-origin-authority.md); this pack
deliberately does not anticipate it.

The pack matches the whole enabled origin (`prefix` path `/`) because Jira's
context path, board, issue, project, and dashboard routes are all part of one
application. Every tool independently rechecks the page origin, application
identity, and context path before a request is built.

The reviewed code is bundled with the extension. There is no downloaded pack
code, main-world injection, caller-provided selector, generic DOM command,
browser automation, or captured-request replay. Service-worker fallbacks always
return `TOOL_NOT_FOUND`, so a real result can only originate in an authorized
matching page. Native WebMCP retains precedence.

## Compatibility fingerprint

The initial fingerprint is `jira-datacenter-rest2-v1`. Admission requires:

- the page origin to be one of the configured deployment origins;
- `ajs-app-title` to identify Jira; and
- `ajs-context-path` to be empty or a bounded path prefix that the current page
  path actually sits under.

`ajs-issue-key` and `ajs-project-key` are optional context. A malformed value is
omitted rather than repaired, and a malformed context path is kept verbatim so
envelope inspection fails closed instead of silently normalizing an attacker's
value. No cookie, token, storage entry, generated class name, or page body text
is part of the fingerprint.

## Network contract

Every tool call is one same-origin `GET` or `POST` under the fixed `/rest/api/2`
prefix of the enabled origin, so the pack declares
`networkPolicy.extensionRequests: "none"` and no tool carries
`EXTERNAL_NETWORK`. The browser attaches the session cookie itself; MCPatch never
reads, stores, or returns it.

The agent supplies neither origin, method, header, raw URL, nor request body.
Paths are assembled from validated identifiers, matched against
`^(?:/[A-Za-z0-9][A-Za-z0-9._~-]*)+$`, and rechecked against the enabled origin
and REST prefix before the request is issued. Requests omit redirects, disable
the cache, and expire after ten seconds. Responses must be JSON, are capped at
512 KiB, and are projected into typed fields; a raw Jira payload never crosses
MCP.

## Tool contracts

### `jira.current_context`

This `READ` accepts an empty object and returns the deployment base URL, context
path, product version, signed-in user identity, and the issue or project key the
current page is showing. It performs no request.

### `jira.get_issue`

This `READ` accepts exactly one `issueKey` in canonical `PROJ-123` form and
requests only the reviewed field set. It returns the issue identity, summary,
status and status category, type, project key, priority, assignee, reporter,
resolution, labels, timestamps, and a description excerpt truncated to 4,096
characters with an explicit `descriptionTruncated` flag.

### `jira.search_issues`

This `READ` accepts a bounded, trimmed, control-character-free `jql` string, an
optional `startAt`, and an optional `limit` from one to 50. JQL is accepted
because Jira's search endpoint is read-only by construction; the call is issued
with `validateQuery=strict` and the reviewed summary field set. A response
carrying more rows than requested fails closed.

### `jira.list_projects`

This `READ` returns at most 50 visible projects with key, name, and optional
project type. Jira Data Center returns every visible project in one array, so the
bounded selection and the optional case-insensitive `query` substring filter
happen in the pack rather than by trusting a server page size. A malformed
project key fails the call.

### `jira.list_comments`

This `READ` returns at most 50 comments of one issue with comment id, author
identity, timestamps, and a body excerpt truncated to 4,096 characters. Only a
user's stable name and display name cross MCP; email, avatar, group, and
visibility fields are dropped.

### `jira.list_transitions`

This `READ` returns at most 32 workflow transitions the signed-in user may
currently apply to one issue, each with its id, name, target status, and target
status category. It is the discovery step that makes `jira.transition_issue`
safe to approve.

### `jira.add_comment`

This `ACTION` accepts exactly one `issueKey` and one `body` of one to 8,192
characters. The body is the only multi-line input the pack accepts; every other
control character is rejected. After the bridge consumes an argument-bound
one-time approval, the pack issues one fixed POST and returns the stored comment
id and creation timestamp. Visibility restrictions, mentions by account id, and
raw comment properties are not expressible.

### `jira.transition_issue`

This `ACTION` accepts one `issueKey` and one numeric `transitionId`. The pack
first reads the transitions the server currently offers and refuses an id that is
not among them, so an unavailable workflow step fails before anything is written.
It then issues one fixed POST and re-reads the issue status. A confirmed status
match returns `confirmed`; a completed write whose confirming read is unavailable
returns `applied_unconfirmed` rather than an error or a retry. Transition screens,
field updates, comments, and resolutions are not part of the contract.

### `jira.create_issue`

This `ACTION` accepts an exact `projectKey`, an `issueType` name, a single-line
`summary`, and optional `description` and unique space-free `labels`. Every
consequential choice is therefore visible in the approval hash. Raw field ids,
custom fields, parent links, reporters, security levels, and watchers are
impossible through the tool contract. The result returns the new issue key and
id.

### `jira.link_issues`

This `ACTION` links two distinct existing issues with one named link type. The
pack first reads the inward issue's links: an identical existing link is a
deterministic `already_linked` no-op with no write. Otherwise it issues one fixed
POST and re-reads to confirm, returning `linked` or, when confirmation is
unavailable, `created_unconfirmed`.

## Single-use writes

`jira.add_comment`, `jira.create_issue`, and `jira.link_issues` are not
idempotent. Each is consumed once per document context and then withdrawn from
discovery, so a retrying agent cannot silently duplicate a comment, an issue, or
a link. Argument validation runs before consumption, so a rejected malformed call
does not burn the capability. `jira.transition_issue` stays repeatable because
every attempt is re-validated against the transitions the server currently
offers.

## Resource and lifecycle bounds

Every metadata value is capped at 256 characters, every projected string at 512,
and every body excerpt at 4,096. Reads admit at most 50 issues, 50 comments, 50
projects from at most 4,096 source rows, 32 transitions, 256 issue links, and 64
labels. Each request has a ten-second deadline and no retry.

A document-local mutation observer watches only `head` metadata and coalesces
reevaluation for 150 milliseconds. An unchanged capability set is not
republished, so ordinary Jira navigation cannot replace the registered route and
revoke an in-flight approval. Navigation, permission removal, pack disable, a
capability-set change, malformed traffic, or bridge disconnect revokes the
context through the common lifecycle.

## Explicit non-goals

- deleting issues, editing arbitrary fields by id, or driving transition screens;
- worklogs, attachments, watchers, and issue-property access;
- agile boards, sprints, versions, and batch creation;
- Jira Cloud's account-id user model and ADF comment bodies; and
- reading or exporting credentials, cookies, storage, headers, or request logs.

Each requires its own reviewed contract rather than a generic request escape
hatch.

## Verification status

The pack is proved by the unit and manifest suites in `packs/jira/tests` and the
bundled-catalog suite in `apps/extension/tests/bundled-jira.test.ts`. It has no
field verification, because a signed-in Jira Data Center instance is required to
run one. Field verification must use a disposable instance and project, invoke
only MCP tools and the extension-owned approval surface, record and restore
state, and must not run in routine CI.

## Related decisions

- [ADR 0005: pack execution](../adr/0005-pack-execution.md)
- [ADR 0006: permissions and approvals](../adr/0006-permission-and-approval-model.md)
- [ADR 0008: origin-scoped content runtime](../adr/0008-origin-scoped-content-runtime.md)
- [ADR 0011: reviewed authenticated session actions](../adr/0011-reviewed-authenticated-session-actions.md)
- [ADR 0014: registry discovery and origin authority](../adr/0014-registry-discovery-and-origin-authority.md)
- [Pack enablement reconciliation](pack-enablement.md)
- [Pack resolution and native precedence](pack-resolution.md)
