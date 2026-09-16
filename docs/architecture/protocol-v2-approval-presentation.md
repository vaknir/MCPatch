# Protocol v2 approval presentation pre-freeze addition

- Status: Accepted pre-release compatibility note
- Date: 2026-09-16
- Issues: [#175](https://github.com/vaknir/MCPatch/issues/175),
  [#193](https://github.com/vaknir/MCPatch/issues/193)
- Precedent: [protocol-v1-approval-correction](protocol-v1-approval-correction.md)

`approval_required` in protocol version 2 gains two required fields:

- `args`: the bridge-validated, bridge-retained arguments the grant's canonical
  hash commits to. At most 128 top-level properties, the same bound as
  `tool_call.args`.
- `requester`: `{ client, session }`. `client` is the MCP client's self-reported
  name after the bridge trims it and keeps it only when it is 1–64 printable
  ASCII characters and spaces with no leading or trailing space, else the fixed
  string `unknown client`; `session`
  is a bridge-assigned identifier (`session-0001`, …) that distinguishes several
  clients with the same name.

## Why the fields exist

Before this change the trusted approval page showed the user a tool name, an
origin, and a 64-character hash. Security review for issue 175 found that a hash
is not something a person can review: a prompt that reads "approve
`jira.add_comment` on `https://jira.example.com` with hash `abcd…`" lets an agent
post any comment body the user cannot see. Issue 193 found the same prompt could
not tell the user which of several connected agents was asking. Both are
presentation failures of the one thing the approval model exists to give the user:
an informed, argument-bound decision.

Showing the arguments does not weaken the binding. The hash is still computed by
the bridge from its retained copy, the grant still binds to that hash, and the
dispatch recheck is unchanged. The page renders the arguments with `textContent`
as pretty-printed JSON, so a value containing markup or an instruction sentence is
displayed as data. The requester line is rendered the same way, and its client
component is filtered to short printable ASCII so it cannot imitate a second
prompt line, a newline, or a bidirectional-override string.

## Why this is not protocol version 3

[VERSIONING.md](../VERSIONING.md) requires a new protocol version to add a field
to a closed message unless a compatibility note explains why the change is
pre-freeze. This is the same situation as the v1 correction:

- MCPatch has no released or distributed build;
- protocol version 2 has one producer (this bridge) and one consumer (this
  extension), shipped together from this repository; and
- no external peer can have implemented the hash-only v2 shape.

Adding version 3 to carry two fields with no deployed v2 peer would add negotiation
and migration code that protects nothing. The schema with `args` and `requester`
is the protocol-v2 `approval_required` contract that future compatibility policy
applies to. Any later removal or meaning change of these fields requires a new
protocol version.

## What must stay true

- The bridge never forwards client-supplied arguments to the prompt before schema
  validation; `args` is populated from the reservation's retained arguments only.
- Debug and log output redacts `args`; an integration test asserts that the
  routed approval's `Debug` output omits argument values.
- Results, credentials, request identifiers, and context identifiers still never
  enter the extension's presentation channel.
- The legacy pre-v1 field name `arguments` remains rejected as unknown, so a
  producer built against the withdrawn shape still fails validation.
