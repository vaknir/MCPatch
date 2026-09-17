# ADR 0016: Every native WebMCP call requires approval

- Status: Accepted
- Date: 2026-09-16
- Issue: [#177](https://github.com/vaknir/MCPatch/issues/177)
- Amends: [ADR 0006](0006-permission-and-approval-model.md)

## Context

A native WebMCP capability is one a page declares through
`document.modelContext`. MCPatch projected every such tool as `risk: "read"`
with `permissions: ["READ"]`, because letting a page choose its own permission
class would let it claim elevated authority.

That forced downgrade stops a page claiming more than it should, but it creates
the inverse failure. The bridge's permission policy allows `[READ]` without an
approval, so a site whose own tool genuinely writes — submit an order, delete a
record — executed with no human decision, because MCPatch had relabelled it a
read. Worse, MCPatch then told the MCP client, on nothing's authority, that the
tool was `readOnlyHint`, `destructive: false` and `idempotent: true`. A client
that auto-approves read-only tools would run page-controlled code unattended.

The threat model says the DOM is untrusted. The permission label for a native
tool was, in practice, decided by the DOM.

## Decision

**A native WebMCP capability never reaches `Allow`.** `permission_decision`
computes the decision its declared risk and permissions imply, and then, for a
`native_webmcp` source, turns an `Allow` into `ApprovalRequired`. Every native
call therefore takes an argument-bound one-time approval through the trusted
surface, showing the user the tool, origin, arguments and requesting client
like any other approved call.

Denials are not softened. A native capability that declares `CREDENTIAL`,
`ARBITRARY_EXECUTION`, `EXTERNAL_NETWORK`, or an unknown permission set is
still denied outright; the rule only removes the approval-free path.

**MCPatch emits no behavioural hints for a native tool.** `tool_annotations`
returns hints only for a reviewed pack, whose risk was fixed by review.
A native tool is listed with no `readOnlyHint`, `destructiveHint` or
`idempotentHint` at all, rather than with hints MCPatch cannot verify.

## Alternatives considered

**Hide native tools entirely in version 1.** Safest and smallest, and worth
revisiting if the draft never gains a verifiable read-only annotation. Rejected
because it removes a working capability to solve a problem that a per-call
approval already solves.

**Per-origin opt-in in trusted UI, plus `SENSITIVE` classification.** The
original proposal in issue 177. Rejected for version 1 because it needs a
second enablement surface and storage shape beside pack enablement, and because
`SENSITIVE` is outside the bundled permission ceiling, which
[ADR 0015](0015-sensitive-read-classification.md) says may only change
alongside its own end-to-end fixture. Per-call approval already removes the
approval-free path; an origin-level gate can be added later without changing
this decision.

## Consequences

- A page cannot obtain approval-free execution of code it controls.
- MCPatch no longer vouches to an MCP client for behaviour it has not reviewed.
- Native tools are more costly to use: every call interrupts the user. That is
  the intended trade for unreviewed, page-authored code, and it is the same
  cost an `ACTION` pack tool already pays.
- Approval prompts for native tools are subject to the same per-site prompt
  budget as any other approval, so a page cannot use them to flood the user.

Name and description isolation for native tools is a separate concern, decided
in [#178](https://github.com/vaknir/MCPatch/issues/178).
