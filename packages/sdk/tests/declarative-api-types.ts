import {
  defineReadTool,
  locator,
  projection,
  scope,
  syntheticDocument,
} from "../src/declarative.js";

const heading = locator.role("heading");
const valid = {
  name: "example.title",
  description: "Read a title",
  risk: "read" as const,
  permissions: ["READ"] as const,
  inputSchema: {
    type: "object" as const,
    additionalProperties: false as const,
    properties: {},
  },
  outputSchema: {
    type: "object" as const,
    additionalProperties: false as const,
    required: ["title"] as const,
    properties: { title: { type: "string" as const } },
  },
  availability: heading,
  scope: scope.single(heading),
  projection: projection.object({ title: projection.text() }),
  fixtures: [
    {
      id: "title",
      document: syntheticDocument({
        url: "https://example.test/",
        root: { tag: "h1", text: "Title" },
      }),
      result: { title: "Title" },
    },
  ],
};

defineReadTool(valid);
defineReadTool({
  ...valid,
  // @ts-expect-error declarative tools cannot contain an executable handler
  execute: () => "Title",
});
defineReadTool({
  ...valid,
  // @ts-expect-error declarative tools require read risk
  risk: "action",
});
defineReadTool({
  ...valid,
  // @ts-expect-error declarative tools require exactly READ
  permissions: ["ACTION"] as const,
});
