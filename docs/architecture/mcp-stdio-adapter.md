# MCP stdio adapter

Issue [#57](https://github.com/vaknir/MCPatch/issues/57) keeps the public stdio
process replaceable and moves the authoritative MCP session into `bridge-core`.

```text
MCP client
  ↕ newline-delimited JSON-RPC
mcpatch mcp-stdio
  ↕ bounded little-endian local frames
mcpatch bridge-core
  ↕ core-owned MCP handler and capability state
```

## Adapter boundary

The adapter accepts one UTF-8 JSON value per line, rejects empty, duplicate-key,
malformed, or larger-than-1-MiB input, and validates the first complete line before
attempting local rendezvous. Clean initial EOF therefore does not start a core. A
valid first frame triggers the shared two-second connect-first startup policy against
the fixed MCP endpoint only; the adapter cannot select or authorize a browser role.

After connection, independent inbound and outbound pumps own their respective stream
halves. No application message queue is added: backpressure is the stdio or local
transport itself. Stdio EOF drops both authenticated IPC halves, while local EOF or a
local framing failure ends the process and closes stdout. Malformed later stdio input
also drops the local session. Standard output contains only complete JSON-RPC lines;
stable payload-free lifecycle and error events go to standard error.

## Core boundary

The bridge core creates the `rmcp` server for every authenticated MCP connection.
Initialization, protocol-version negotiation, request handling, tool discovery, and
future access to shared capability/policy state therefore remain in the elected core,
not in adapters. Unix and Windows enforce eight concurrent sessions per parser role.
Each accepted stream has an idle-safe five-second deadline that begins only after the
first byte of an incomplete local frame arrives.

Tests cover real process initialization and empty discovery, multiple core-owned
sessions, per-role limits, malformed and oversized stdio, local loss, stdio EOF, and
the authenticated Unix and Windows transport paths. No TCP, HTTP, or browser-facing
surface is introduced.
