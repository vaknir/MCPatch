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
Pack Manifest v1 accepts exact HTTPS origins only, so the shipped manifest
declares one synthetic `.invalid` origin in `packs/jira/src/deployment.ts` as a
marker: this is a **configurable-origin** pack.

The real origin is configured by the user in extension storage
(`mcpatch.origins.v1`) and substituted for the placeholder when the catalog is
built. The extension then requests and proves only that exact origin at a user
gesture, as [ADR 0015](../adr/0015-configurable-pack-origins.md) sets out. Until
configuration exists the pack contributes no site, matches no page, and cannot be
enabled; the placeholder itself is never requested, granted, or matched.

Because the pack's origin is not a compile-time constant, the pack itself does
not carry an origin allowlist. The binding lives in the extension: the content
runtime is registered only for the granted origin, and every REST call is built
from the page's own origin and rechecked against it. The pack's envelope check is
therefore structural — a canonical HTTPS origin — plus Jira's application
identity and context path.

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

Every tool call is one same-origin request under one of two fixed REST roots of
the enabled origin: `/rest/api/2`, and `/rest/agile/1.0` for boards and sprints,
which have no core-API equivalent. Both are compile-time constants reached
through separate namespaces on the client, so the surface stays two closed roots
rather than a caller-selectable API path. The pack declares
`networkPolicy.extensionRequests: "none"` and no tool carries
`EXTERNAL_NETWORK`. The browser attaches the session cookie itself; MCPatch never
reads, stores, or returns it.

The pack uses `GET`, `POST`, `PUT`, and `DELETE`. This is not extra authority.
`networkPolicy.extensionRequests` — including its `GET`/`POST` method
restriction — governs extension-issued cross-origin requests paired with
`EXTERNAL_NETWORK` tools, which this pack never makes; the manifest validator
only inspects a tool's methods when that permission is present.
[ADR 0011](../adr/0011-reviewed-authenticated-session-actions.md) states that a
reviewed pack's authenticated same-origin action "is not a new manifest
permission class", and its enumerated constraints are about argument binding,
bounded responses, and postconditions rather than the HTTP verb. The write
authority here comes from the enabled page origin plus the bridge's
argument-bound one-time approval, exactly as it does for `POST`.

The agent supplies neither origin, method, header, raw URL, nor request body;
the method is chosen by reviewed pack code from a closed set. Paths are
assembled from validated identifiers, matched against
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

### `jira.list_issue_links`

This `READ` returns at most 256 links of one issue, each with its exact id,
type, direction, and the issue on the other side. It is the discovery step that
makes `jira.remove_issue_link` approvable: without it the agent would have no
way to name a link except by guessing an id.

### `jira.update_issue`

This `ACTION` sets a closed set of **named** fields on one exact issue: summary,
description, priority, labels, and due date. A generic field-id map is
deliberately not expressible — it would place an opaque blob in front of the
user at approval time, while named properties put every changed value in the
approval hash. Raw field ids, custom fields, status, reporter, parent, and
security level therefore have no path through this tool; status changes belong
to `jira.transition_issue`, which validates against the server's own workflow.

At least one field must be present. Due dates are checked as real calendar dates,
so `2026-02-30` fails. Setting `labels` replaces the issue's label set. The
confirming read compares the untruncated stored values, so a description longer
than the 4,096-character read excerpt is still confirmed exactly rather than
against its excerpt. The result names the fields it set and reports `confirmed`
or `applied_unconfirmed`.

### `jira.assign_issue` and `jira.unassign_issue`

These `ACTION` tools set or clear one issue's assignee through Jira's dedicated
assignee endpoint. They are two tools rather than one tool with a sentinel
value: a single `assignee` argument would need a reserved string for "nobody",
and a real Jira account named that string would then be unreachable — or worse,
silently unassign. Splitting them removes the ambiguity and makes each the
distinct action the user approves. An unchanged assignee is a no-op with no
write.

### `jira.remove_issue_link`

This `ACTION` removes one link by exact id, but only after reading the links of
the issue the approval named and proving the id is among them. That binding is
the point: a link id alone addresses every link in the instance, so without the
precondition an approval for one issue would carry authority over any other.
An unavailable confirming read returns `removed_unconfirmed`.

### `jira.list_worklogs` and `jira.add_worklog`

The read returns at most 50 entries with author, start time, logged duration and
a bounded comment excerpt. The action appends exactly one entry: `timeSpent`
must match Jira's own duration grammar, an optional `startedAt` is a strict
UTC ISO-8601 instant converted to Jira's `+0000` form, and estimate adjustment
stays on Jira's `auto` default. Setting a remaining estimate or rewriting an
existing entry is not expressible.

### `jira.list_attachments`

Reports attachment metadata — filename, media type, size, creation time, author
— and never the bytes or the content URL. Transferring arbitrary file content
across MCP is a different capability class from typed field reads and needs its
own reviewed contract with a size and media-type boundary, as the bounded
image-result contract does for chart captures.

### `jira.list_issue_link_types` and `jira.get_user`

Two discovery reads that make other tools approvable with exact values instead
of guesses: link types for `jira.link_issues`, and a user's stable username for
`jira.assign_issue`. `get_user` returns username, display name and active state
only; email address, avatar and group membership are dropped at the projection.

### `jira.list_versions` and `jira.create_version`

The read returns at most 50 versions with release and archive state. The action
creates one version from named bounded fields; it cannot release, archive,
reorder, move or delete one.

### `jira.list_boards`, `jira.list_sprints`, `jira.list_sprint_issues`, `jira.create_sprint`

The three reads are bounded and scoped to one exact board or sprint;
`list_sprint_issues` returns the same typed summaries as `search_issues`, so an
agent sees one issue shape everywhere. Sprint state arrives from the server in
any case and is normalized to `active`, `closed` or `future`; an unrecognized
state fails closed. `create_sprint` creates one future sprint on one exact
board and never starts, closes or reorders one — a sprint state change is its
own consequential action and needs its own contract.

### `jira.delete_issue`

The only irreversible tool in the pack, and the only one with no `*_unconfirmed`
state. It reads the target first, so the approval carries the exact key and the
result reports the summary that was destroyed. An issue with subtasks is refused
unless `deleteSubtasks: true` is among the approved arguments, so the server's
own cascade default is never silently inherited.

There is no readback, deliberately: this pack's errors are payload-free, so a
post-delete read cannot distinguish "gone" from "unreachable", and reporting
`deleted` on an unreachable instance would assert something unknown. Jira's own
successful DELETE status is the postcondition instead.

## Single-use writes

Seven actions append, create, or destroy: `jira.add_comment`,
`jira.add_worklog`, `jira.create_issue`, `jira.create_sprint`,
`jira.create_version`, `jira.link_issues`, and `jira.delete_issue`. Each is
consumed once per document context and then withdrawn from discovery, so a
retrying agent cannot silently duplicate a comment, worklog, issue, sprint,
version or link, nor re-attempt a destroyed issue. Argument validation runs
before consumption, so a rejected malformed call does not burn the capability.

The remaining actions set a named end state rather than appending, so repeating
one converges instead of accumulating. They stay repeatable and re-validate
their preconditions on every attempt: `jira.transition_issue` against the
transitions the server currently offers, `jira.remove_issue_link` against the
links currently on the approved issue, and the assignment tools against the
current assignee.

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

- transferring attachment bytes, which is a separate capability class needing
  its own size and media-type contract;
- editing arbitrary fields by id, driving transition screens, or batch creating
  issues under one approval;
- starting, closing, reordering, or deleting sprints, and releasing, archiving
  or deleting versions;
- watchers, issue properties, field-id discovery, and Jira Cloud's account-id
  user model and ADF comment bodies; and
- reading or exporting credentials, cookies, storage, headers, or request logs.

Each requires its own reviewed contract rather than a generic request escape
hatch. Widening `jira.update_issue` means adding named, bounded fields to its
closed schema, never a field-id passthrough.

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
