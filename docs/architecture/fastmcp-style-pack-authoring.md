# FastMCP-style pack authoring

MCPatch pack authors should describe browser capabilities with the same mental
model used to build an MCP server: create one application, register typed tools,
and let the runtime publish and route them.

```ts
const mcp = new MCPatch(metadata);

mcp.tool(toolMetadata, async (input, context) => {
  context.signal.throwIfAborted();
  return performReviewedOperation(input);
});

export const pack = mcp.build({ fixtures });
```

`MCPatch` is an authoring facade, not another MCP transport. MCP clients still
connect to the Rust bridge. The extension still owns the authenticated browser
context, advertises only enabled page capabilities, and routes each invocation to
one reviewed pack adapter.

## Why schemas remain explicit

FastMCP can derive schemas from Python annotations because those annotations are
available to its runtime. TypeScript types are erased. MCPatch therefore requires
closed JSON input schemas and explicit output schemas, then uses those same values
to infer callback types at compile time and validate untrusted calls at runtime.

This keeps one contract for the agent, bridge, extension, fixture harness, and pack
implementation. Adding a second schema DSL is deferred until it can produce the
same deterministic data artifact without runtime code generation.

## Registration and finalization

- `mcp.tool(metadata, handler)` validates and snapshots tool metadata immediately.
- The returned handler is the original function and can be unit-tested directly.
- `mcp.build({ fixtures })` validates the complete manifest and creates the frozen
  manifest/handler definition consumed by the existing runtime.
- A builder is single-use. Registration and rebuilding are rejected after `build`.
- Tool names must belong to the pack publisher and duplicates fail at registration.

The lower-level `defineTool` and `definePack` functions remain supported for code
generation and immutable composition.

## Security boundary

The authoring facade does not add browser authority. Tool callbacks receive only
typed input plus `contextId`, exact origin, cancellation signal, and adapter
functions explicitly closed over by reviewed bundled code. It provides no generic
DOM dump, cookie access, token access, arbitrary JavaScript execution, unrestricted
network request, or runtime code-loading feature.

Resources and prompts are intentionally absent. MCPatch's current browser protocol
advertises typed callable capabilities; adding another MCP component requires a
separate protocol and threat-model decision.
