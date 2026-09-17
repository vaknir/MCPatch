# Jira Data Center MCPatch pack

This reviewed bundled pack exposes the core Jira capability surface of an
MCP Atlassian server without a server, an API token, or an outbound connection:
it reuses the browser session the user already has on their own self-hosted
Jira Data Center or Server instance.

## Capabilities

Reads (`READ`):

- `jira.current_context` reports the enabled base URL, product version, signed-in
  user, and the issue or project the current page is showing;
- `jira.get_issue` reads one issue by exact key with status, type, project,
  people, labels, timestamps, and a bounded description excerpt;
- `jira.search_issues` runs one bounded read-only JQL query and returns at most
  50 typed issue summaries;
- `jira.list_projects` lists at most 50 visible projects, optionally narrowed by
  a bounded key or name substring;
- `jira.list_comments` reads at most 50 comments with author identity,
  timestamps, and a bounded body excerpt;
- `jira.list_transitions` reads the workflow transitions the signed-in user may
  currently apply to one issue;
- `jira.list_issue_links` reads one issue's links with each link's exact id,
  type, direction, and the issue on the other side;
- `jira.list_issue_link_types` reads the link types this deployment defines;
- `jira.list_worklogs` reads at most 50 worklog entries of one issue;
- `jira.list_attachments` reads attachment **metadata** of one issue;
- `jira.get_user` reads one user's username, display name, and active state;
- `jira.list_versions` reads at most 50 versions of one project; and
- `jira.list_boards`, `jira.list_sprints`, and `jira.list_sprint_issues` read
  agile boards, their sprints, and one sprint's issues.

Actions (`ACTION`, each behind an argument-bound one-time approval):

- `jira.add_comment` adds one bounded plain-text comment to one exact issue;
- `jira.transition_issue` applies one currently offered workflow transition and
  confirms the resulting status;
- `jira.create_issue` creates one issue from an exact project key, issue type,
  summary, and optional description and labels;
- `jira.update_issue` sets one or more **named** fields of one exact issue —
  summary, description, priority, labels, due date — and nothing else;
- `jira.assign_issue` and `jira.unassign_issue` set or clear one issue's
  assignee;
- `jira.link_issues` links two exact existing issues with one named link type;
- `jira.remove_issue_link` removes one link by exact id, but only when that link
  is currently on the issue the approval named;
- `jira.add_worklog` logs one bounded duration against one issue;
- `jira.create_version` creates one unreleased version in one project;
- `jira.create_sprint` creates one future sprint on one exact board; and
- `jira.delete_issue` permanently deletes one exact issue.

Seven actions append, create, or destroy — `jira.add_comment`,
`jira.add_worklog`, `jira.create_issue`, `jira.create_sprint`,
`jira.create_version`, `jira.link_issues`, and `jira.delete_issue` — so each is
consumed once per document context and then withdrawn from discovery. A
retrying agent cannot silently duplicate or re-destroy. The other actions set a
named end state rather than appending, so they stay repeatable and re-validate
their preconditions on every attempt.

`jira.delete_issue` is the only irreversible tool here. It reads the target
first, so the result reports the summary that was destroyed, and it refuses an
issue that has subtasks unless `deleteSubtasks: true` is in the approved
arguments — the server's own cascade default is never inferred. It has no
`*_unconfirmed` state on purpose: a post-delete read cannot tell "gone" from
"unreachable" through payload-free errors, so Jira's successful DELETE status is
the postcondition rather than a readback that could report a deletion that did
not happen.

Every action that writes then reads back. When the write succeeded but the
confirming read did not agree or was unavailable, the result says so explicitly
(`applied_unconfirmed`, `assigned_unconfirmed`, `created_unconfirmed`,
`removed_unconfirmed`) instead of erroring or retrying, so an uncertain outcome
is never mistaken for a clean one. Where the requested state already holds the
result is a deterministic no-op (`already_assigned`, `already_linked`,
`already_unassigned`) with no write at all.

`jira.update_issue` takes **named** fields, not a field map: raw field ids,
custom fields, status, reporter, parent, and security level are not
expressible, so every value a user approves is visible in the approval hash.
Setting `labels` replaces the issue's label set.

## Boundary

Page reads use only Jira's own `ajs-*` metadata. Cookies, tokens, storage,
generated class names, and page body text are never collected or returned.

Every call is a same-origin request under one of two fixed REST roots of the
enabled site — `/rest/api/2`, and `/rest/agile/1.0` for boards and sprints,
which have no core equivalent. Both are compile-time constants, so the surface
is two closed roots rather than a caller-selectable API path. The pack declares
`networkPolicy.extensionRequests: "none"` and
no tool holds `EXTERNAL_NETWORK`. Same-origin session actions are not a manifest
permission class ([ADR 0011](../../docs/adr/0011-reviewed-authenticated-session-actions.md)),
and `networkPolicy.extensionRequests` governs extension-issued cross-origin
requests, which this pack never makes — so `PUT` and `DELETE` carry no authority
beyond `GET` and `POST` here.

The method is chosen by reviewed pack code from a closed set, never by the
agent, which also cannot choose an origin, a header, a raw URL, a custom field,
or a request body. Paths are assembled from validated identifiers only and
re-checked against the enabled origin and REST prefix before the request is
issued. Responses are bounded, must be JSON, and are projected into typed
fields; raw Jira payloads never reach the agent.

`jira.search_issues` accepts JQL because Jira's search endpoint is read-only by
construction; the query is bounded, control-character free, and executed with
`validateQuery=strict`. There is no generic request, attachment download, issue
delete, or field-by-id update tool.

The compatibility fingerprint is `jira-datacenter-rest2-v1`, which covers Jira
Data Center and Jira Server deployments serving REST API v2 under an optional
context path.

## Configuring a deployment origin

Jira Data Center is self-hosted, so its exact HTTPS origin is a deployment fact
rather than a reviewed constant. Pack Manifest v1 accepts exact origins only,
and the extension grants authority only for an origin present in both
`DECLARED_OPTIONAL_ORIGINS` and `optional_host_permissions`.

The shipped build therefore declares one synthetic `.invalid` origin: the pack
is compiled, validated, and fully tested, but it can never become page authority
until an operator opts in. To enable it for one instance:

1. replace `JIRA_PLACEHOLDER_ORIGIN` in [`src/deployment.ts`](src/deployment.ts)
   with the instance base origin, for example `https://jira.example.com`;
2. add `https://jira.example.com/*` to `optional_host_permissions` in
   [`apps/extension/manifest.json`](../../apps/extension/manifest.json); and
3. rebuild the extension and enable the pack from the toolbar action on a Jira
   page.

`apps/extension/tests/bundled-jira.test.ts` fails if those two lists disagree.
Runtime-selected origins are a separate trust decision tracked by
[ADR 0014](../../docs/adr/0014-registry-discovery-and-origin-authority.md).

## Manifest digest

`manifest.digest` is the SHA-256 of the compiled manifest with its own `digest`
field removed, so it is stable and non-circular.
[`tests/digest.test.ts`](tests/digest.test.ts) recomputes it and fails whenever
the declared value drifts from the manifest; its assertion message prints the
value to write back into `src/manifest.ts`.

## Not included

Four gaps against MCP Atlassian's Jira surface remain, each for a stated
reason rather than for lack of time:

- **Attachment download.** Moving arbitrary file bytes across MCP is a different
  capability class from typed field reads. It needs its own reviewed contract
  with a size and media-type boundary, like the bounded image-result contract
  packs use today. `jira.list_attachments` reports what is attached instead.
- **Arbitrary field update by id.** A generic field-id map would put an opaque
  blob in front of the user at approval time. Widening `jira.update_issue`
  means adding named, bounded fields to its closed schema.
- **Batch issue creation.** One approval covering N issues defeats the point of
  argument-bound approval. Repeat `jira.create_issue` instead.
- **Sprint state changes and field discovery.** Starting or closing a sprint is
  a distinct consequential action needing its own contract, and `search_fields`
  exists to find field ids, which this pack does not accept.

Jira Cloud's account-id user model and ADF comment bodies are also out of scope;
this pack targets Data Center and Server.
