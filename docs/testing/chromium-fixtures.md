# Deterministic Chromium fixtures

The Chromium suite exercises the built MV3 extension, Native Messaging executable,
bridge core, and MCP stdio adapter against synthetic pages. It does not use a real
website, account, cookie, credential, or remote endpoint.

## Run locally

Install the Playwright-pinned browser once, then run the single repository command:

```sh
pnpm exec playwright install --no-shell chromium
pnpm test:browser
```

Set `MCPATCH_BROWSER_HEADED=1` for a visible local browser. The normal run uses
Playwright's `chromium` channel and its new headless implementation so MV3 service
workers and unpacked extensions remain available.

The command builds the debug Rust executable, production extension, and a separate
fixture-only extension under `.artifacts/`. It then creates a unique browser profile
inside the Playwright output directory. On Linux and macOS, that profile receives
one Native Messaging manifest pointing to the just-built executable. No system or
default-browser registration is required.

## Covered behavior

The scenario proves:

- stable extension identity and real Native Messaging hello negotiation;
- MCP discovery and exact invocation of a page-reported pack capability, with
  service-worker fallback handlers set to fail closed;
- output-schema validation of current visible page state after page execution;
- DOM mutation refresh and replacement of the capability snapshot;
- cancellation from MCP through the bridge and extension into the page adapter;
- same-origin document reload and fresh context revision;
- malformed page-channel input without loss of the bridge session;
- cross-origin navigation revocation; and
- disable-time script and capability revocation; and
- realm lockdown blocking every network primitive and `document.cookie` from a
  pack handler on a real page, via the `fixture.realm_probe` tool, while the
  credential-free DOM read still succeeds.

All HTTP(S) requests outside two synthetic `.test` origins are aborted. Chromium is
also launched with a deny-all DNS resolver rule; allowed fixture responses are
fulfilled in-process by Playwright. The suite asserts that fixture arguments,
results, and tool names do not appear in bridge logs.

## Test-only authority boundary

Headless Chromium cannot complete the browser-owned optional-host permission prompt.
The fixture manifest therefore pre-authorizes exactly
`https://fixture.mcpatch.test/*`. A click in the extension control page still writes
the same closed enablement record used by production, and disable still exercises
production reconciliation and revocation. Unit tests separately exercise optional
permission grant, denial, removal, startup reconciliation, and corruption.

This exception exists only in `.artifacts/chromium-fixture-extension`. The fixture
build is marked, and it refuses to proceed if the production manifest contains a
required host permission or if fixture origin/adapter markers appear in production
JavaScript. Production continues to request one reviewed optional origin from a
user gesture and defaults to no site authority.

## Platforms and CI

The automated profile-local Native Messaging setup supports Linux and macOS. The
browser scenario is skipped on Windows because Chromium requires per-user registry
registration there; Windows manifest and registry behavior remains covered by Rust
tests and the cross-target gate. CI contains an Ubuntu Chromium job ready for use
when hosted Actions billing is restored.

The browser version is pinned by `@playwright/test`. Updating Playwright requires a
fresh local run and an updated scrubbed report under `docs/test-reports/`.

References:

- [Playwright Chrome extension testing](https://playwright.dev/docs/next/chrome-extensions)
- [Playwright browser installation](https://playwright.dev/docs/browsers)
- [Chrome Native Messaging locations](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging#native-messaging-host-location)
