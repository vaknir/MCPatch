# Local demo workflow

MCPatch includes one deterministic transport proof, `mcpatch.demo.status`. It is a
reviewed compiled pack under the synthetic origin
`https://demo.mcpatch.invalid`; it neither reads a website nor uses browser
credentials.

## Supported automated workflow

From the repository root, run:

```sh
cargo test --package mcpatch-bridge \
  --test demo_capability_process \
  --all-features --locked \
  bundled_demo_runs_across_native_host_core_and_mcp_processes \
  -- --exact --nocapture
```

The scenario starts the real platform bridge core, drives a real `native-host`
process as a fake Chromium extension port, and connects a real `mcp-stdio` process.
It then verifies:

1. protocol negotiation and publication of the shared demo snapshot;
2. `tools/list` exposes exactly the typed demo contract;
3. `tools/call` crosses both authenticated local boundaries and returns
   `{ "status": "ready" }`;
4. context closure cancels a pending invocation and removes the tool;
5. browser disconnect revokes another pending invocation and removes the tool; and
6. a restarted core begins empty and requires a fresh browser negotiation and
   snapshot before the tool returns.

The same scenario runs in Linux and macOS workspace tests and as an explicit Windows
CI step. It uses no registry test hook, TCP listener, website permission, cookie,
network request, or generic browser automation.

## Extension build

The unpacked extension can be built with:

```sh
pnpm --filter @mcpatch/extension build
```

The output is `apps/extension/dist`. Its service worker admits the reviewed pack,
applies exact matching and native-first resolution, and implements the same demo
contract used by the process test. The build rejects dynamic code generation.

For a real Native Messaging registration, build an attributable local package and
run its dry-run/install command as documented in [Local packaging and Chromium
registration](installation.md). The stable unpacked-extension identity and native
host allowlist are bound, but MCPatch remains pre-alpha and must not be used with
sensitive browser accounts.
