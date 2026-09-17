# Declarative pack runtime

The Declarative Operations interpreter is packaged with the extension and runs
inside its isolated content world. A downloaded pack supplies data only. It cannot
add JavaScript, selectors outside the closed locator grammar, browser APIs, or a
new execution primitive.

## Authority boundary

`DeclarativePackRuntime` accepts one already-installed bundle, its exact content
digest, and one route binding:

- tab, document, context, and context revision;
- canonical HTTPS origin and current path; and
- exact bundle digest.

Creation revalidates the complete bundle, recomputes its digest, checks manifest
matching, and freezes the route. Discovery and every call repeat structural and
digest validation. A trusted binding callback is checked before and after each
adapter or projection step. Route replacement, navigation, permission loss,
bundle replacement, disconnect, or uninstall must revoke the runtime before
cleanup; revocation aborts all in-flight work. Registry and publisher signature
verification remains an installation-boundary responsibility because signer trust
roots never enter page content.

The existing page protocol already binds calls and responses to tab, document,
origin, context revision, request, and tool. Dynamic installation will provide
the additional path and digest binding when it constructs this runtime; those
values are never supplied by the page or MCP caller.

## Document adapter

The pure interpreter sees opaque node handles through three operations only:

1. bounded lookup using a validated role or structured locator;
2. bounded semantic text; and
3. one allowlisted readable attribute.

The packaged DOM adapter traverses incrementally and never returns `Document`,
`Element`, raw HTML, computed style, canvas data, storage, cookies, network access,
or a generic property/query primitive. Hidden semantic containers such as
`script`, `style`, and `template` are excluded from text reads. CSS visibility is
not inferred through computed style; page text remains untrusted output.

## Deterministic execution

Each call has one combined cancellation/deadline controller and exact limits for
visited nodes, matches, text, attributes, projection depth, output nodes, and
serialized output bytes. Output is charged incrementally before values are added
to a result so a rejected result cannot first grow without bounds. List reads are
sequential and preserve document order.

Number, percentage, and boolean parsing follows the Operations v1 contract.
Generated data is checked against the declared tool output schema again before it
can cross the page channel. All failures collapse to stable codes without DOM
text, selector literals, arguments, or results.

Operations v2 navigation bypasses the document adapter entirely. The runtime
constructs one URL from the signed static template and validated arguments,
returns only a scheduled acknowledgement, and asks the navigation coordinator to
revoke the old page runtime before one deferred captured `location.assign`.
There is no generic navigation, selector mutation, form, click, or request API.

## Runtime separation

Declarative execution is implemented separately from `CompiledPackRuntime` and
its handler tables. Google Flights, TradingView, and other compiled reviewed packs
retain their existing code and policy. The existing page router continues to
publish both native and pack candidates while routing an exact-name collision to
native WebMCP.
