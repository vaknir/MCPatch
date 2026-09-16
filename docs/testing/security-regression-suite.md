# Security regression suite

The red-team pass verified a set of properties by hand. This suite pins them so a
regression fails a named test rather than passing review unnoticed. Everything here
runs without network access as part of `cargo test --workspace` and `pnpm test`,
except the Windows and manual checks called out below.

## Bridge over real stdio

`crates/bridge/tests/mcp_stdio_abuse.rs` drives the shipped `mcpatch mcp-stdio`
executable exactly as an MCP client would, with `RUST_LOG=trace` and
`MCPATCH_LOG=trace`, and attaches a browser peer over the same local IPC the
extension uses so calls exercise the full core routing path. Shared process
helpers live in `crates/bridge/tests/stdio_support/`, which the existing
`mcp_stdio_process.rs` suite also uses.

| Property                                                                                                                                                                                   | Test                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Hostile tool names, argument keys/values, and prototype-pollution keys (`__proto__`, `constructor`, `prototype`) are rejected and never appear in stdout or stderr, even at `trace`        | `hostile_tool_names_and_arguments_never_reach_stdout_or_stderr`     |
| A 2.5 MiB frame, 200 000-deep nesting, duplicate keys, invalid UTF-8, and an out-of-range `id` each end the session with a stable code and exit 1, no crash, no echoed input, bounded logs | `frame_abuse_ends_the_session_with_a_stable_code_and_no_echo`       |
| `requestState` / `inputResponses` continuation state is refused before routing, with nothing dispatched to the browser                                                                     | `continuation_state_is_refused_before_routing`                      |
| Concurrent `tools/call` requests are all reserved, dispatched, and answered exactly once with no starvation                                                                                | `concurrent_calls_are_answered_exactly_once_without_starvation`     |
| A `2026-07-28` or newer/unknown client negotiates down to the pinned `2025-11-25`, so an rmcp upgrade that changes negotiation is noticed                                                  | `newer_and_unknown_client_versions_negotiate_to_the_pinned_version` |

The concurrency batch is deliberately smaller than the browser session's bounded
transport queue, so the test proves genuine concurrent handling rather than
measuring the queue closing under a larger burst. The per-connection reservation
and snapshot ceilings are unit-tested separately in
`crates/bridge/tests/capability_approvals.rs`.

## Extension against a hostile page

These run in `pnpm test` (Vitest) and exercise the adapter and worker logic
directly against adversarial `getTools()` output and message shapes.

| Property                                                                                                                                             | Test                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getTools()` returning accessor properties, non-plain prototypes, `toJSON` hooks, or an over-long description is rejected without invoking the hooks | `native WebMCP adapter > omits serialization hooks and over-long descriptions without invoking them` (and the existing `omits empty titles and rejects unsafe candidates without reading accessors`)                 |
| A `toolchange` flood collapses into one capability snapshot                                                                                          | `page content runtime > collapses a toolchange flood into one snapshot`                                                                                                                                              |
| A native tool named identically to a pack tool is dropped rather than colliding                                                                      | existing `native WebMCP adapter > omits every ambiguous native name without falling back to either handle` and `page-backed compiled-pack routing > keeps native WebMCP precedence over a colliding page-pack route` |
| The trusted approval page is unreachable from web content (no `web_accessible_resources`, no `externally_connectable`)                               | `extension manifest > keeps the approval page unreachable from web content`                                                                                                                                          |

| The isolated realm lockdown blocks `fetch` to an undeclared origin, `http`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, and `document.cookie` while preserving declared-origin requests | `realm lockdown` (11 tests in `tests/realm-lockdown.test.ts`); the Chromium fixture `fixture.realm_probe` proves it on a real page |

The Chromium end-to-end fixture (`apps/extension/e2e/`, run with
`pnpm test:browser`) additionally proves these boundaries against a real page,
Native Messaging host, and bridge core; see
[chromium-fixtures.md](chromium-fixtures.md).

## Windows IPC

`crates/bridge/src/local_ipc/windows/security.rs` unit tests assert the named-pipe
and named-mutex DACLs are protected (`D:P`), carry exactly one allow ACE for the
current logon SID, and grant no rights to Everyone, Anonymous, Authenticated Users,
or Network principals. `crates/bridge/tests/local_ipc_windows.rs` covers
first-instance exclusion, client authentication before any frame is read, and that
client impersonation is reverted before parsing. These run only on Windows
(`#![cfg(windows)]`) and are exercised by the per-target CI job and the local
verification record.

Two Windows checks require a host the automated suite cannot provision and are
**manual**, recorded in the verification record for a release:

- **Impersonation level.** With a debugger or `Process Monitor`, confirm the core
  reverts to self immediately after reading the client's logon SID and never acts
  under the client's token while parsing or routing.
- **Singleton election under a second user session.** Sign in as a second Windows
  user on the same machine, start a core in each session, and confirm each elects
  its own per-logon named mutex and pipe (distinct DACLs) with no cross-session
  connection.

## Running the suite

The security regression tests are part of the standard commands in
[CONTRIBUTING.md](../../CONTRIBUTING.md); no separate invocation is needed:

```sh
pnpm test
cargo test --workspace --all-features --locked
```

On Windows, also run the `#![cfg(windows)]` tests and record the two manual checks
above in a dated report under [docs/test-reports/](../test-reports/).
