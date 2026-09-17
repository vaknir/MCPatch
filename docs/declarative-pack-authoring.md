# Declarative pack authoring

`@mcpatch/sdk/declarative` builds a community pack as data. It has no
handler callback, browser object, document, or network client. Finalization runs the
same Pack Manifest v1, Declarative Operations, bundle, and JSON Schema checks
used at the runtime boundary.

This complete unknown-site pack reads one heading from one explicit HTTPS origin:

```ts
import {
  EMPTY_INPUT_SCHEMA,
  buildDeclarativePack,
  defineReadTool,
  locator,
  projection,
  scope,
  syntheticDocument,
} from "@mcpatch/sdk/declarative";

const heading = locator.role("heading", { name: "Article title" });

const title = defineReadTool({
  name: "example.article_title",
  description: "Read the current article title",
  risk: "read",
  permissions: ["READ"],
  inputSchema: EMPTY_INPUT_SCHEMA,
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: { title: { type: "string" } },
  },
  availability: heading,
  scope: scope.single(heading),
  projection: projection.object({ title: projection.text() }),
  fixtures: [
    {
      id: "article-title",
      document: syntheticDocument({
        url: "https://news.example/article/one",
        root: {
          tag: "main",
          children: [
            {
              tag: "h1",
              role: "heading",
              accessibleName: "Article title",
              text: "A synthetic headline",
            },
          ],
        },
      }),
      result: { title: "A synthetic headline" },
    },
  ],
});

export const pack = await buildDeclarativePack({
  publisher: "example",
  id: "news-reader",
  name: "Example news reader",
  description: "Read article titles from news.example",
  version: "0.1.0",
  compatibility: {
    runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
    bridgeProtocol: { minimum: 2, maximum: 2 },
  },
  matches: [
    {
      origin: "https://news.example",
      paths: [{ kind: "prefix", path: "/article/" }],
    },
  ],
  metadata: { license: "MIT", homepage: "https://news.example/pack" },
  tools: [title],
});
```

`pack.bundleContent` is the validated unsigned bundle content for publisher signing.
`pack.buildInput` is its deterministic RFC 8785 JSON representation. The generated
manifest, operations program, fixtures, bundle content, and nested values are all
deeply frozen.

The fixture tree is inert data rather than HTML. The #145 interpreter can be wired
to `verifyDeclarativeFixtures` from `@mcpatch/sdk/declarative-fixtures` through one
runner method:

```ts
import { verifyDeclarativeFixtures } from "@mcpatch/sdk/declarative-fixtures";

const evidence = await verifyDeclarativeFixtures(pack, {
  run: ({ operation, document }) => interpreter.run(operation, document),
});
```

The runner boundary grants no extension internals. It receives only one validated
operation and one immutable synthetic document. The harness independently validates
the returned value against the declared output schema and exact fixture result.

## Add a typed navigation action

`defineNavigationTool` is the only side effect available to a declarative pack.
The caller supplies values, not a URL; the pack owns the static same-origin route:

```ts
import { defineNavigationTool } from "@mcpatch/sdk/declarative";

const changeSymbol = defineNavigationTool({
  name: "charts.change_symbol",
  description: "Open a chart for one exchange-qualified symbol",
  risk: "action",
  permissions: ["ACTION"],
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["symbol", "market"],
    properties: {
      symbol: { type: "string", minLength: 1, maxLength: 32 },
      market: {
        type: "string",
        minLength: 1,
        maxLength: 8,
        enum: ["US", "UK"],
      },
    },
  },
  navigation: {
    navigationVersion: 1,
    path: {
      segments: [
        { kind: "literal", value: "chart" },
        { kind: "argument", name: "symbol" },
      ],
      trailingSlash: false,
    },
    query: [{ key: "market", value: { kind: "argument", name: "market" } }],
  },
  fixtures: [
    {
      id: "change-symbol",
      currentUrl: "https://charts.example/chart/OLD",
      input: { symbol: "NASDAQ:AAPL", market: "US" },
      expectedUrl: "https://charts.example/chart/NASDAQ%3AAAPL?market=US",
    },
  ],
});
```

Including this tool makes the generated pack use Operations v2. Read-only packs
remain v1. Every argument must appear exactly once in the path or a statically
named query entry. Runtime calls require the normal extension-owned one-time
ACTION approval; successful tool output says only that navigation was scheduled.
