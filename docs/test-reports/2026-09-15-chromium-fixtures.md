# Chromium fixture report — 2026-09-15

Status: **passed locally**

Environment:

- source branch: `feat/104-chromium-fixtures`
- host: macOS arm64
- Node.js: 24.21.0
- Playwright: 1.63.0
- Chromium: 153.0.8010.12, Playwright `chromium` channel
- extension identity: `imbnpameklobbabbkfkalcfcggpjacdi`
- mode: new headless Chromium, isolated temporary profile

Evidence:

- 1 browser scenario passed;
- Native Messaging used the real `mcpatch` executable and authenticated local IPC;
- MCP initialization, discovery, calls, and cancellation used newline-delimited
  stdio through the real bridge core;
- `fixture.current_state` returned only synthetic values `initial` and `updated`;
- `fixture.wait` observed cancellation in the isolated page adapter;
- refresh, malformed page input, cross-origin navigation, and disable each removed
  stale page authority; and
- the synthetic demo remained callable after malformed page traffic.

Security observations:

- no production site, account, cookie, token, or personal content was used;
- browser DNS was denied and fixture documents were fulfilled in-process;
- bridge logs contained no fixture arguments, results, or capability names;
- the fixture-only required host permission is excluded from and checked against the
  production artifact; and
- the profile-local host manifest contained only the canonical executable, `stdio`,
  fixed native host name, and fixed extension origin.

Known limitations:

- headless Chromium cannot automate its optional-host permission prompt, so exact
  optional permission UI is covered below the browser UI boundary by deterministic
  controller tests;
- Windows requires registry-backed Native Messaging setup and is not part of this
  Playwright scenario; and
- this report validates synthetic page behavior, not a production website or the
  experimental browser-provided `document.modelContext` implementation.

No raw page output, MCP frames, browser profile, or Native Messaging diagnostics are
retained in this report.
