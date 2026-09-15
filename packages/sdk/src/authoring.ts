import type { InferPackInput, InferPackOutput } from "./schema-inference.js";
import {
  authoringObject,
  reject,
  remapToolIssue,
} from "./authoring-validation.js";
import type {
  JsonObject,
  JsonValue,
  PackFixture,
  PackManifest,
  PackToolManifest,
} from "./types.js";
import { parsePackManifest } from "./validation/manifest.js";
import { cloneAndFreeze, isRecord, issue } from "./validation/primitives.js";
import { validateTools } from "./validation/tools.js";

const TOOL_FIELDS = [
  "name",
  "title",
  "description",
  "risk",
  "permissions",
  "inputSchema",
  "outputSchema",
  "execute",
] as const;
const OPTIONAL_TOOL_FIELDS = new Set(["title"]);
const PACK_FIELDS = [
  "manifestVersion",
  "publisher",
  "id",
  "name",
  "description",
  "version",
  "digest",
  "compatibility",
  "execution",
  "matches",
  "networkPolicy",
  "tools",
  "fixtures",
] as const;
const TOOL_DEFINITIONS = new WeakSet<object>();

/** Narrow, runtime-supplied context available to reviewed compiled handlers. */
export interface PackExecutionContext {
  readonly contextId: string;
  readonly origin: string;
  readonly signal: AbortSignal;
}

/** Handler contract inferred from a tool's declared input and output schemas. */
export type PackToolHandler<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> = (
  context: PackExecutionContext,
  input: TInput,
) => TOutput | Promise<TOutput>;

export type PackToolAuthoringInput<
  TName extends string,
  TInputSchema extends JsonObject,
  TOutputSchema extends JsonObject,
> = Omit<PackToolManifest, "inputSchema" | "name" | "outputSchema"> & {
  readonly name: TName;
  readonly inputSchema: TInputSchema;
  readonly outputSchema: TOutputSchema;
  readonly execute: PackToolHandler<
    InferPackInput<TInputSchema>,
    InferPackOutput<TOutputSchema>
  >;
};

export interface PackToolDefinition<
  TName extends string = string,
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> {
  readonly manifest: PackToolManifest & { readonly name: TName };
  readonly execute: PackToolHandler<TInput, TOutput>;
}

type AnyToolDefinition = PackToolDefinition<string, never, JsonValue>;
type ToolName<TTools extends readonly AnyToolDefinition[]> =
  TTools[number]["manifest"]["name"];
type FixturesFor<TTools extends readonly AnyToolDefinition[]> = readonly (Omit<
  PackFixture,
  "tool"
> & { readonly tool: ToolName<TTools> })[];

export type PackAuthoringInput<TTools extends readonly AnyToolDefinition[]> =
  Omit<PackManifest, "fixtures" | "tools"> & {
    readonly tools: TTools;
    readonly fixtures: FixturesFor<TTools>;
  };

export type PackHandlerTable<TTools extends readonly AnyToolDefinition[]> = {
  readonly [
    TTool in TTools[number] as TTool["manifest"]["name"]
  ]: TTool["execute"];
};

export interface PackDefinition<TTools extends readonly AnyToolDefinition[]> {
  /** Complete serializable Pack Manifest v1 artifact; contains no handlers. */
  readonly manifest: PackManifest;
  /** Reviewed compiled handlers keyed by their validated manifest tool names. */
  readonly handlers: PackHandlerTable<TTools>;
}

/** Defines and freezes one validated compiled-tool definition. */
export function defineTool<
  const TName extends string,
  const TInputSchema extends JsonObject,
  const TOutputSchema extends JsonObject,
>(
  input: PackToolAuthoringInput<TName, TInputSchema, TOutputSchema>,
): PackToolDefinition<
  TName,
  InferPackInput<TInputSchema>,
  InferPackOutput<TOutputSchema>
> {
  const source = authoringObject(
    input,
    TOOL_FIELDS,
    OPTIONAL_TOOL_FIELDS,
    "tool",
  );
  if (typeof source.execute !== "function") {
    reject(issue("INVALID_TYPE", "tool.execute"));
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
  const publisher =
    typeof manifestCandidate.name === "string"
      ? (manifestCandidate.name.split(".")[0] ?? "")
      : "";
  const validation = validateTools([manifestCandidate], publisher);
  if ("issue" in validation) reject(remapToolIssue(validation.issue));

  const definition = Object.freeze({
    manifest: cloneAndFreeze(manifestCandidate),
    execute: source.execute,
  }) as PackToolDefinition<
    TName,
    InferPackInput<TInputSchema>,
    InferPackOutput<TOutputSchema>
  >;
  TOOL_DEFINITIONS.add(definition);
  return definition;
}

/** Derives a validated manifest and separate handler table from branded tools. */
export function definePack<const TTools extends readonly AnyToolDefinition[]>(
  input: PackAuthoringInput<TTools>,
): PackDefinition<TTools> {
  const source = authoringObject(input, PACK_FIELDS, new Set(), "$");
  if (!Array.isArray(source.tools)) reject(issue("INVALID_TYPE", "tools"));
  const tools = source.tools as unknown[];
  for (const [index, tool] of tools.entries()) {
    if (!isRecord(tool) || !TOOL_DEFINITIONS.has(tool)) {
      reject(issue("INVALID_TYPE", `tools[${index}]`));
    }
  }

  const manifests = tools.map(
    (tool) => (tool as unknown as AnyToolDefinition).manifest,
  );
  const manifest = parsePackManifest({
    manifestVersion: source.manifestVersion,
    publisher: source.publisher,
    id: source.id,
    name: source.name,
    description: source.description,
    version: source.version,
    digest: source.digest,
    compatibility: source.compatibility,
    execution: source.execution,
    matches: source.matches,
    networkPolicy: source.networkPolicy,
    tools: manifests,
    fixtures: source.fixtures,
  });
  const handlers = Object.create(null) as Record<string, PackToolHandler>;
  for (const tool of tools as unknown as AnyToolDefinition[]) {
    Object.defineProperty(handlers, tool.manifest.name, {
      configurable: false,
      enumerable: true,
      value: tool.execute,
      writable: false,
    });
  }
  return Object.freeze({
    manifest,
    handlers: Object.freeze(handlers) as unknown as PackHandlerTable<TTools>,
  });
}
