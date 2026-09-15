# Protocol v1 approval pre-freeze correction

- Status: Accepted pre-release compatibility note
- Date: 2026-09-15
- Issue: [#102](https://github.com/vaknir/MCPatch/issues/102)

The Phase 1 protocol fixtures originally placed raw tool arguments in
`approval_required`. Before the approval runtime was implemented, security review
for issue 102 required raw arguments and results never to enter approval messages.
The field has therefore been removed and is now rejected as unknown.

This is a pre-freeze correction rather than a migration between deployed protocol
peers:

- MCPatch has no released or distributed build;
- the bridge previously rejected every `approval_result` as an unsupported
  application message;
- the extension had no approval producer or user interface; and
- the old approval request existed only as schemas, types, and synthetic fixtures.

No released v1 implementation can depend on the removed field. Incrementing the
wire version and retaining an unsafe, never-implemented version 1 would add migration
code without preserving a real compatibility target. The hash-only schema produced
by issue 102 is the protocol-v1 approval contract that future compatibility policy
applies to. Any subsequent field removal or meaning change requires a new protocol
version under [VERSIONING.md](../VERSIONING.md).
