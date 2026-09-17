import { PROTOCOL_VERSION } from "@mcpatch/protocol";
import {
  decodeDeclarativePackBundle,
  packSupportsBridgeProtocol,
  packSupportsRuntime,
  type DeclarativeAriaRole,
  type DeclarativeHtmlTag,
  type DeclarativeLocatorAttribute,
  type DeclarativeSafeAttribute,
  type JsonObject,
  type JsonValue,
  type PackCompatibility,
  type PackMatch,
} from "@mcpatch/sdk";
import {
  buildDeclarativePack,
  defineNavigationTool,
  defineReadTool,
  locator,
  projection,
  scalar,
  scope,
  syntheticDocument,
  type DeclarativeFixture,
  type DeclarativePackBuild,
  type DeclarativeToolDefinition,
  type LocatorBuilder,
  type ProjectionBuilder,
  type ScalarSourceBuilder,
  type ScopeBuilder,
  type SyntheticDocument,
} from "@mcpatch/sdk/declarative";

import { cliError } from "./errors.js";
import { PACK_SOURCE_VERSION } from "./model.js";

const SOURCE_FIELDS = [
  "sourceVersion",
  "publisher",
  "id",
  "name",
  "description",
  "version",
  "compatibility",
  "matches",
  "metadata",
  "tools",
] as const;
const TOOL_FIELDS = [
  "name",
  "title",
  "description",
  "risk",
  "permissions",
  "inputSchema",
  "outputSchema",
  "availability",
  "scope",
  "projection",
  "fixtures",
] as const;
const NAVIGATION_TOOL_FIELDS = [
  "name",
  "title",
  "description",
  "risk",
  "permissions",
  "inputSchema",
  "navigation",
  "fixtures",
] as const;
const FIXTURE_FIELDS = ["id", "document", "result"] as const;
const MAX_SOURCE_TOOLS = 128;
const MAX_SOURCE_FIXTURES = 256;
const MAX_SOURCE_DEPTH = 32;
const CURRENT_RUNTIME_VERSION = "0.1.0";

export interface PreparePackOptions {
  readonly sourceCommit?: string;
}

/** Strictly decodes and finalizes the data-only authoring source. */
export async function preparePackSource(
  input: string | Uint8Array,
  options: PreparePackOptions = {},
): Promise<DeclarativePackBuild> {
  const decoded = decodeDeclarativePackBundle(input);
  const source = exactObject(decoded, SOURCE_FIELDS, [], "$source");
  if (source.sourceVersion !== PACK_SOURCE_VERSION) {
    cliError("INCOMPATIBLE_SOURCE_VERSION", "$source.sourceVersion");
  }
  const tools = readArray(
    source.tools,
    "$source.tools",
    1,
    MAX_SOURCE_TOOLS,
  ).map((tool, index) => readTool(tool, `$source.tools[${index}]`));
  const metadata = exactObject(
    source.metadata,
    ["license", "homepage"],
    ["homepage"],
    "$source.metadata",
  );
  const build = await buildDeclarativePack({
    publisher: source.publisher as string,
    id: source.id as string,
    name: source.name as string,
    description: source.description as string,
    version: source.version as string,
    compatibility: source.compatibility as PackCompatibility,
    matches: source.matches as readonly PackMatch[],
    metadata: {
      license: metadata.license as string,
      ...(Object.hasOwn(metadata, "homepage")
        ? { homepage: metadata.homepage as string }
        : {}),
      ...(options.sourceCommit === undefined
        ? {}
        : { sourceCommit: options.sourceCommit }),
    },
    tools,
  });
  if (!packSupportsRuntime(build.manifest, CURRENT_RUNTIME_VERSION)) {
    cliError("PACK_INCOMPATIBLE", "$source.compatibility.runtime");
  }
  if (!packSupportsBridgeProtocol(build.manifest, PROTOCOL_VERSION)) {
    cliError("PACK_INCOMPATIBLE", "$source.compatibility.bridgeProtocol");
  }
  return build;
}

function readTool(value: unknown, field: string): DeclarativeToolDefinition {
  const candidate = dataObject(value, field);
  if (candidate.risk === "action") return readNavigationTool(candidate, field);
  const tool = exactObject(value, TOOL_FIELDS, ["title"], field);
  const fixtures = readArray(
    tool.fixtures,
    `${field}.fixtures`,
    1,
    MAX_SOURCE_FIXTURES,
  ).map((fixture, index) =>
    readFixture(fixture, `${field}.fixtures[${index}]`),
  );
  return defineReadTool({
    name: tool.name as string,
    ...(Object.hasOwn(tool, "title") ? { title: tool.title as string } : {}),
    description: tool.description as string,
    risk: tool.risk as "read",
    permissions: tool.permissions as readonly ["READ"],
    inputSchema: tool.inputSchema as {
      readonly type: "object";
      readonly additionalProperties: false;
      readonly properties: Readonly<Record<string, never>>;
    },
    outputSchema: tool.outputSchema as JsonObject,
    availability: readLocator(tool.availability, `${field}.availability`),
    scope: readScope(tool.scope, `${field}.scope`, 0),
    projection: readProjection(tool.projection, `${field}.projection`, 0),
    fixtures,
  });
}

function readNavigationTool(
  value: unknown,
  field: string,
): DeclarativeToolDefinition {
  const tool = exactObject(value, NAVIGATION_TOOL_FIELDS, ["title"], field);
  const fixtures = readArray(
    tool.fixtures,
    `${field}.fixtures`,
    1,
    MAX_SOURCE_FIXTURES,
  ).map((fixture, index) => {
    const fixtureField = `${field}.fixtures[${index}]`;
    const checked = exactObject(
      fixture,
      ["id", "currentUrl", "input", "expectedUrl"],
      [],
      fixtureField,
    );
    return {
      id: checked.id as string,
      currentUrl: checked.currentUrl as string,
      input: checked.input as JsonObject,
      expectedUrl: checked.expectedUrl as string,
    };
  });
  return defineNavigationTool({
    name: tool.name as string,
    ...(Object.hasOwn(tool, "title") ? { title: tool.title as string } : {}),
    description: tool.description as string,
    risk: tool.risk as "action",
    permissions: tool.permissions as readonly ["ACTION"],
    inputSchema: tool.inputSchema as JsonObject,
    navigation: tool.navigation as Parameters<
      typeof defineNavigationTool
    >[0]["navigation"],
    fixtures,
  });
}

function readFixture(value: unknown, field: string): DeclarativeFixture {
  const fixture = exactObject(value, FIXTURE_FIELDS, [], field);
  return {
    id: fixture.id as string,
    document: syntheticDocument(fixture.document as SyntheticDocument),
    result: fixture.result as JsonValue,
  };
}

function readLocator(value: unknown, field: string): LocatorBuilder {
  const candidate = dataObject(value, field);
  if (candidate.kind === "role") {
    const role = exactObject(
      candidate,
      ["kind", "role", "name"],
      ["name"],
      field,
    );
    return locator.role(role.role as DeclarativeAriaRole, {
      ...(Object.hasOwn(role, "name") ? { name: role.name as string } : {}),
    });
  }
  if (candidate.kind === "selector") {
    const selector = exactObject(
      candidate,
      ["kind", "tag", "id", "classes", "attributes"],
      ["tag", "id", "classes", "attributes"],
      field,
    );
    return locator.selector({
      ...(Object.hasOwn(selector, "tag")
        ? { tag: selector.tag as DeclarativeHtmlTag }
        : {}),
      ...(Object.hasOwn(selector, "id") ? { id: selector.id as string } : {}),
      ...(Object.hasOwn(selector, "classes")
        ? { classes: selector.classes as readonly string[] }
        : {}),
      ...(Object.hasOwn(selector, "attributes")
        ? {
            attributes: selector.attributes as readonly Readonly<{
              readonly name: DeclarativeLocatorAttribute;
              readonly value: string;
            }>[],
          }
        : {}),
    });
  }
  cliError("SOURCE_INVALID", `${field}.kind`);
}

function readScope(value: unknown, field: string, depth: number): ScopeBuilder {
  assertDepth(depth, field);
  const candidate = dataObject(value, field);
  if (candidate.kind === "single") {
    const single = exactObject(candidate, ["kind", "locator"], [], field);
    return scope.single(readLocator(single.locator, `${field}.locator`));
  }
  if (candidate.kind === "list") {
    const list = exactObject(
      candidate,
      ["kind", "locator", "maxMatches"],
      [],
      field,
    );
    return scope.list(readLocator(list.locator, `${field}.locator`), {
      maxMatches: list.maxMatches as number,
    });
  }
  cliError("SOURCE_INVALID", `${field}.kind`);
}

function readProjection(
  value: unknown,
  field: string,
  depth: number,
): ProjectionBuilder {
  assertDepth(depth, field);
  const candidate = dataObject(value, field);
  switch (candidate.kind) {
    case "text":
      exactObject(candidate, ["kind"], [], field);
      return projection.text();
    case "attribute": {
      const attribute = exactObject(candidate, ["kind", "name"], [], field);
      return projection.attribute(attribute.name as DeclarativeSafeAttribute);
    }
    case "constant": {
      const constant = exactObject(candidate, ["kind", "value"], [], field);
      return projection.constant(constant.value as JsonValue);
    }
    case "number":
    case "percentage":
    case "boolean": {
      const scalarProjection = exactObject(
        candidate,
        ["kind", "source"],
        [],
        field,
      );
      const source = readScalarSource(
        scalarProjection.source,
        `${field}.source`,
      );
      return candidate.kind === "number"
        ? projection.number(source)
        : candidate.kind === "percentage"
          ? projection.percentage(source)
          : projection.boolean(source);
    }
    case "optional": {
      const optional = exactObject(candidate, ["kind", "value"], [], field);
      return projection.optional(
        readProjection(optional.value, `${field}.value`, depth + 1),
      );
    }
    case "descendant": {
      const descendant = exactObject(
        candidate,
        ["kind", "scope", "projection"],
        [],
        field,
      );
      return projection.descendant(
        readScope(descendant.scope, `${field}.scope`, depth + 1),
        readProjection(descendant.projection, `${field}.projection`, depth + 1),
      );
    }
    case "object": {
      const object = exactObject(candidate, ["kind", "fields"], [], field);
      const fields = readArray(object.fields, `${field}.fields`, 1, 64);
      const mapped: Record<string, ProjectionBuilder> = Object.create(
        null,
      ) as Record<string, ProjectionBuilder>;
      for (const [index, entry] of fields.entries()) {
        const itemField = `${field}.fields[${index}]`;
        const item = exactObject(entry, ["key", "value"], [], itemField);
        if (typeof item.key !== "string" || Object.hasOwn(mapped, item.key)) {
          cliError("SOURCE_INVALID", `${itemField}.key`);
        }
        Object.defineProperty(mapped, item.key, {
          enumerable: true,
          value: readProjection(item.value, `${itemField}.value`, depth + 1),
        });
      }
      return projection.object(mapped);
    }
    case "array": {
      const array = exactObject(candidate, ["kind", "items"], [], field);
      return projection.array(
        readArray(array.items, `${field}.items`, 0, 64).map((item, index) =>
          readProjection(item, `${field}.items[${index}]`, depth + 1),
        ),
      );
    }
    default:
      cliError("SOURCE_INVALID", `${field}.kind`);
  }
}

function readScalarSource(value: unknown, field: string): ScalarSourceBuilder {
  const candidate = dataObject(value, field);
  if (candidate.kind === "text") {
    exactObject(candidate, ["kind"], [], field);
    return scalar.text();
  }
  if (candidate.kind === "attribute") {
    const attribute = exactObject(candidate, ["kind", "name"], [], field);
    return scalar.attribute(attribute.name as DeclarativeSafeAttribute);
  }
  cliError("SOURCE_INVALID", `${field}.kind`);
}

function exactObject(
  value: unknown,
  fields: readonly string[],
  optional: readonly string[],
  field: string,
): Record<string, unknown> {
  const object = dataObject(value, field);
  const allowed = new Set(fields);
  const optionalFields = new Set(optional);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) cliError("SOURCE_INVALID", `${field}.${key}`);
  }
  for (const key of fields) {
    if (!optionalFields.has(key) && !Object.hasOwn(object, key)) {
      cliError("SOURCE_INVALID", `${field}.${key}`);
    }
  }
  return object;
}

function dataObject(value: unknown, field: string): Record<string, unknown> {
  const prototype =
    typeof value === "object" && value !== null
      ? (Object.getPrototypeOf(value) as unknown)
      : undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    (prototype !== Object.prototype && prototype !== null)
  ) {
    cliError("SOURCE_INVALID", field);
  }
  return value as Record<string, unknown>;
}

function readArray(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): readonly unknown[] {
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    value.length > maximum
  ) {
    cliError("SOURCE_INVALID", field);
  }
  return value;
}

function assertDepth(depth: number, field: string): void {
  if (depth > MAX_SOURCE_DEPTH) cliError("SOURCE_INVALID", field);
}
