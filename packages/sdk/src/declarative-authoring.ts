import { authoringObject } from "./authoring-validation.js";
import { canonicalizeOrThrow } from "./declarative-bundle-canonical.js";
import { computeDeclarativePackBundleDigest } from "./declarative-bundle.js";
import { validateBundleContent } from "./declarative-bundle-validation.js";
import {
  DeclarativePackBundleValidationError,
  type DeclarativePackBundleContent,
  type DeclarativePackBundleMetadata,
} from "./declarative-bundle-types.js";
import { bundleIssue } from "./declarative-bundle-limits.js";
import {
  type LocatorBuilder,
  type ProjectionBuilder,
  type ScopeBuilder,
  unwrapLocator,
  unwrapProjection,
  unwrapScope,
} from "./declarative-builders.js";
import type {
  DeclarativeOperation,
  DeclarativeOperationsProgram,
} from "./declarative-operations-types.js";
import type { InferPackOutput } from "./schema-inference.js";
import {
  syntheticDocument,
  type SyntheticDocument,
} from "./declarative-synthetic-document.js";
import type {
  JsonObject,
  JsonValue,
  PackCompatibility,
  PackFixture,
  PackManifest,
  PackMatch,
  PackToolManifest,
} from "./types.js";
import { compileToolSchemas } from "./fixture-harness-validation.js";
import { canonicalizePageLocation, packMatchesLocation } from "./location.js";
import {
  cloneAndFreeze,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object" as const,
  additionalProperties: false as const,
  properties: Object.freeze({}),
});

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
const PACK_FIELDS = [
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
const FIXTURE_FIELDS = ["id", "document", "result"] as const;
const TOOL_DEFINITIONS = new WeakSet<object>();

export type ClosedEmptyInputSchema = Readonly<{
  readonly type: "object";
  readonly additionalProperties: false;
  readonly properties: Readonly<Record<string, never>>;
}>;

export interface DeclarativeFixture<TOutput extends JsonValue = JsonValue> {
  readonly id: string;
  readonly document: SyntheticDocument;
  readonly result: TOutput;
}

export interface DeclarativeReadToolInput<
  TName extends string,
  TOutputSchema extends JsonObject,
> {
  readonly name: TName;
  readonly title?: string;
  readonly description: string;
  readonly risk: "read";
  readonly permissions: readonly ["READ"];
  readonly inputSchema: ClosedEmptyInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly availability: LocatorBuilder;
  readonly scope: ScopeBuilder;
  /** Canonical validation proves projection/output-schema parity at finalization. */
  readonly projection: ProjectionBuilder;
  readonly fixtures: readonly DeclarativeFixture<
    InferPackOutput<TOutputSchema>
  >[];
}

export interface DeclarativeReadToolDefinition<TName extends string = string> {
  readonly name: TName;
}

interface StoredTool {
  readonly manifest: PackToolManifest;
  readonly operation: DeclarativeOperation;
  readonly fixtures: readonly DeclarativeFixture[];
}

const storedTools = new WeakMap<object, StoredTool>();

export interface DeclarativePackInput<
  TTools extends readonly DeclarativeReadToolDefinition[],
> {
  readonly publisher: string;
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly compatibility: PackCompatibility;
  readonly matches: readonly PackMatch[];
  readonly metadata: DeclarativePackBundleMetadata;
  readonly tools: TTools;
}

export interface BuiltDeclarativeFixture extends DeclarativeFixture {
  readonly tool: string;
}

export interface DeclarativePackBuild {
  readonly manifest: PackManifest;
  readonly program: DeclarativeOperationsProgram;
  readonly fixtures: readonly BuiltDeclarativeFixture[];
  readonly bundleContent: DeclarativePackBundleContent;
  /** RFC 8785 JSON supplied to signing/reproducible build tooling. */
  readonly buildInput: string;
}

/** Defines data-only read authority. No callback or ambient runtime enters it. */
export function defineReadTool<
  const TName extends string,
  const TOutputSchema extends JsonObject,
>(
  input: DeclarativeReadToolInput<TName, TOutputSchema>,
): DeclarativeReadToolDefinition<TName> {
  const source = authoringObject(
    input,
    TOOL_FIELDS,
    new Set(["title"]),
    "tool",
  );
  if (
    source.risk !== "read" ||
    !Array.isArray(source.permissions) ||
    source.permissions.length !== 1 ||
    source.permissions[0] !== "READ"
  ) {
    reject("INVALID_PERMISSION", "tool.permissions");
  }
  if (!isClosedEmptyInput(source.inputSchema)) {
    reject("INVALID_SCHEMA", "tool.inputSchema");
  }
  if (!Array.isArray(source.fixtures) || source.fixtures.length === 0) {
    reject("INVALID_REFERENCE", "tool.fixtures");
  }
  if (validateJsonBounds(source.fixtures) !== undefined) {
    reject("INVALID_TYPE", "tool.fixtures");
  }

  const manifestCandidate = {
    name: source.name,
    ...(Object.hasOwn(source, "title") ? { title: source.title } : {}),
    description: source.description,
    risk: source.risk,
    permissions: source.permissions,
    inputSchema: source.inputSchema,
    outputSchema: source.outputSchema,
  };
  if (validateJsonBounds(manifestCandidate) !== undefined) {
    reject("INVALID_TYPE", "tool");
  }
  const manifest = cloneAndFreeze(manifestCandidate) as PackToolManifest;
  const operation = cloneAndFreeze({
    kind: "read",
    tool: source.name,
    availability: {
      kind: "present",
      locator: unwrapLocator(source.availability as LocatorBuilder),
    },
    scope: unwrapScope(source.scope as ScopeBuilder),
    projection: unwrapProjection(source.projection as ProjectionBuilder),
  }) as DeclarativeOperation;
  if (validateJsonBounds({ manifest, operation }) !== undefined) {
    reject("INVALID_TYPE", "tool");
  }
  const fixtures = (source.fixtures as readonly unknown[]).map(
    (fixture, index) => validateFixture(fixture, `tool.fixtures[${index}]`),
  );
  const definition = Object.freeze({
    name: source.name,
  }) as DeclarativeReadToolDefinition<TName>;
  storedTools.set(
    definition,
    Object.freeze({ manifest, operation, fixtures: Object.freeze(fixtures) }),
  );
  TOOL_DEFINITIONS.add(definition);
  return definition;
}

/** Finalizes one deterministic, validated unsigned bundle build input. */
export async function buildDeclarativePack<
  const TTools extends readonly DeclarativeReadToolDefinition[],
>(input: DeclarativePackInput<TTools>): Promise<DeclarativePackBuild> {
  const source = authoringObject(input, PACK_FIELDS, new Set(), "pack");
  if (!Array.isArray(source.tools) || source.tools.length === 0) {
    reject("INVALID_REFERENCE", "pack.tools");
  }
  if (validateJsonBounds(source) !== undefined) reject("INVALID_TYPE", "pack");
  const tools = (source.tools as readonly unknown[]).map((tool, index) => {
    if (!isRecord(tool) || !TOOL_DEFINITIONS.has(tool)) {
      reject("INVALID_TYPE", `pack.tools[${index}]`);
    }
    const stored = storedTools.get(tool);
    if (stored === undefined) reject("INVALID_TYPE", `pack.tools[${index}]`);
    return stored;
  });
  const program: DeclarativeOperationsProgram = {
    version: 1,
    operations: tools.map((tool) => tool.operation),
  };
  const fixtures: BuiltDeclarativeFixture[] = tools.flatMap((tool) =>
    tool.fixtures.map((fixture) => ({
      id: fixture.id,
      tool: tool.manifest.name,
      document: fixture.document,
      result: fixture.result,
    })),
  );
  const manifestFixtures: PackFixture[] = fixtures.map((fixture) => ({
    id: fixture.id,
    tool: fixture.tool,
    input: {},
    expect: { kind: "result", result: fixture.result },
  }));
  const manifest: PackManifest = {
    manifestVersion: 1,
    publisher: source.publisher as string,
    id: source.id as string,
    name: source.name as string,
    description: source.description as string,
    version: source.version as string,
    digest: `sha256:${"0".repeat(64)}`,
    compatibility: source.compatibility as PackCompatibility,
    execution: { kind: "declarative", operationsVersion: 1 },
    matches: source.matches as readonly PackMatch[],
    networkPolicy: { extensionRequests: "none" },
    tools: tools.map((tool) => tool.manifest),
    fixtures: manifestFixtures,
  };
  const initial = cloneAndFreeze({
    bundleVersion: 1,
    manifest,
    operations: { operationsVersion: 1, program },
    metadata: source.metadata as DeclarativePackBundleMetadata,
  }) as DeclarativePackBundleContent;
  validateContent(initial);
  validateFixtureSchemas(manifest.tools, fixtures);
  validateFixtureLocations(manifest, fixtures);
  const digest = await computeDeclarativePackBundleDigest(initial);
  const content = cloneAndFreeze({
    ...initial,
    manifest: { ...initial.manifest, digest },
  }) as DeclarativePackBundleContent;
  validateContent(content);
  return cloneAndFreeze({
    manifest: content.manifest,
    program: content.operations.program,
    fixtures,
    bundleContent: content,
    buildInput: canonicalizeOrThrow(content),
  }) as DeclarativePackBuild;
}

function validateFixture(value: unknown, field: string): DeclarativeFixture {
  const fixture = authoringObject(value, FIXTURE_FIELDS, new Set(), field);
  if (typeof fixture.id !== "string") reject("INVALID_TYPE", `${field}.id`);
  if (!isRecord(fixture.document)) reject("INVALID_TYPE", `${field}.document`);
  if (validateJsonBounds(fixture) !== undefined) reject("INVALID_TYPE", field);
  return cloneAndFreeze({
    id: fixture.id,
    document: syntheticDocument(
      fixture.document as unknown as SyntheticDocument,
    ),
    result: fixture.result,
  }) as DeclarativeFixture;
}

function validateContent(content: DeclarativePackBundleContent): void {
  const issue = validateBundleContent(content);
  if (issue !== undefined)
    throw new DeclarativePackBundleValidationError(issue);
}

function validateFixtureSchemas(
  tools: readonly PackToolManifest[],
  fixtures: readonly BuiltDeclarativeFixture[],
): void {
  const compiled = compileToolSchemas(tools);
  if (compiled.invalidTools.size > 0) reject("INVALID_SCHEMA", "tools");
  for (const fixture of fixtures) {
    const validators = compiled.validators.get(fixture.tool);
    if (validators === undefined || !validators.output(fixture.result)) {
      reject("INVALID_SCHEMA", "fixtures");
    }
  }
}

function validateFixtureLocations(
  manifest: PackManifest,
  fixtures: readonly BuiltDeclarativeFixture[],
): void {
  for (const fixture of fixtures) {
    const location = canonicalizePageLocation(fixture.document.url);
    if (!location.ok || !packMatchesLocation(manifest, location.location)) {
      reject("INVALID_REFERENCE", "fixtures.document.url");
    }
  }
}

function isClosedEmptyInput(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const keys = Reflect.ownKeys(value);
  const type = Object.getOwnPropertyDescriptor(value, "type");
  const additionalProperties = Object.getOwnPropertyDescriptor(
    value,
    "additionalProperties",
  );
  const properties = Object.getOwnPropertyDescriptor(value, "properties");
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length !== 3 ||
    type === undefined ||
    !("value" in type) ||
    type.value !== "object" ||
    additionalProperties === undefined ||
    !("value" in additionalProperties) ||
    additionalProperties.value !== false ||
    properties === undefined ||
    !("value" in properties) ||
    !isRecord(properties.value) ||
    Reflect.ownKeys(properties.value).length !== 0
  ) {
    return false;
  }
  return true;
}

function reject(
  code: ConstructorParameters<
    typeof DeclarativePackBundleValidationError
  >[0]["code"],
  field: string,
): never {
  throw new DeclarativePackBundleValidationError(bundleIssue(code, field));
}

export { EMPTY_INPUT_SCHEMA };
