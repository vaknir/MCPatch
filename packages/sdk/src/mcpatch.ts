import type { InferPackInput, InferPackOutput } from "./schema-inference.js";
import {
  definePack,
  defineTool,
  type PackDefinition,
  type PackExecutionContext,
  type PackToolAuthoringInput,
  type PackToolDefinition,
} from "./authoring.js";
import { authoringObject, reject } from "./authoring-validation.js";
import type {
  JsonObject,
  JsonValue,
  PackFixture,
  PackManifest,
  PackManifestValidationIssue,
} from "./types.js";
import type { PackToolReturn } from "./tool-result.js";
import {
  cloneAndFreeze,
  issue,
  validateJsonBounds,
} from "./validation/primitives.js";

const PACK_OPTION_FIELDS = [
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
] as const;
const TOOL_OPTION_FIELDS = [
  "name",
  "title",
  "description",
  "risk",
  "permissions",
  "inputSchema",
  "outputSchema",
] as const;
const OPTIONAL_TOOL_OPTION_FIELDS = new Set(["title"]);
const MAX_TOOLS = 128;

type AnyToolDefinition = PackToolDefinition<string, never, JsonValue>;

/** Immutable serializable metadata supplied when an MCPatch pack is created. */
export type MCPatchOptions = Omit<PackManifest, "fixtures" | "tools">;

/** Tool metadata kept separate from the directly testable implementation. */
export type MCPatchToolOptions<
  TName extends string,
  TInputSchema extends JsonObject,
  TOutputSchema extends JsonObject,
> = Omit<PackToolAuthoringInput<TName, TInputSchema, TOutputSchema>, "execute">;

/** FastMCP-style tool callback with runtime context injected after typed input. */
export type MCPatchToolHandler<
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> = (
  input: TInput,
  context: PackExecutionContext,
) => PackToolReturn<TOutput> | Promise<PackToolReturn<TOutput>>;

export interface MCPatchBuildOptions {
  readonly fixtures: readonly PackFixture[];
}

export type MCPatchDefinition = PackDefinition<readonly AnyToolDefinition[]>;

/**
 * High-level authoring surface for a reviewed browser capability pack.
 *
 * Like FastMCP, tool registration hides protocol publication and keeps handlers
 * directly callable. MCPatch additionally requires explicit schemas, risk, and
 * permissions because TypeScript annotations do not exist at runtime and the
 * browser is a privileged security boundary.
 */
export class MCPatch {
  readonly #options: MCPatchOptions;
  readonly #publisher: string;
  readonly #tools: AnyToolDefinition[] = [];
  readonly #toolNames = new Set<string>();
  #built = false;

  constructor(options: MCPatchOptions) {
    const source = authoringObject(
      options,
      PACK_OPTION_FIELDS,
      new Set(),
      "pack",
    );
    const boundsIssue = validateJsonBounds(source);
    if (boundsIssue !== undefined) reject(remapPackIssue(boundsIssue));
    this.#options = cloneAndFreeze(source) as MCPatchOptions;
    this.#publisher =
      typeof source.publisher === "string" ? source.publisher : "";
  }

  /** Registers one typed tool and returns its original directly callable handler. */
  tool<
    const TName extends string,
    const TInputSchema extends JsonObject,
    const TOutputSchema extends JsonObject,
  >(
    options: MCPatchToolOptions<TName, TInputSchema, TOutputSchema>,
    handler: MCPatchToolHandler<
      InferPackInput<TInputSchema>,
      InferPackOutput<TOutputSchema>
    >,
  ): typeof handler {
    this.#assertOpen();
    const source = authoringObject(
      options,
      TOOL_OPTION_FIELDS,
      OPTIONAL_TOOL_OPTION_FIELDS,
      "tool",
    );
    if (typeof handler !== "function") {
      reject(issue("INVALID_TYPE", "tool.execute"));
    }
    const definition = defineTool({
      ...source,
      execute: (context, input) => handler(input, context),
    } as PackToolAuthoringInput<TName, TInputSchema, TOutputSchema>);
    const name = definition.manifest.name;
    if (!name.startsWith(`${this.#publisher}.`)) {
      reject(issue("INVALID_IDENTIFIER", "tool.name"));
    }
    if (this.#toolNames.has(name)) {
      reject(issue("DUPLICATE_VALUE", "tool.name"));
    }
    if (this.#tools.length >= MAX_TOOLS) {
      reject(issue("LIMIT_EXCEEDED", "tools"));
    }
    this.#toolNames.add(name);
    this.#tools.push(definition as unknown as AnyToolDefinition);
    return handler;
  }

  /** Finalizes this single-use builder into the existing immutable runtime contract. */
  build(options: MCPatchBuildOptions): MCPatchDefinition {
    this.#assertOpen();
    const source = authoringObject(options, ["fixtures"], new Set(), "build");
    this.#built = true;
    return definePack({
      ...this.#options,
      tools: this.#tools,
      fixtures: source.fixtures as readonly PackFixture[],
    });
  }

  #assertOpen(): void {
    if (this.#built) throw new TypeError("MCPatch pack is already built");
  }
}

function remapPackIssue(
  validationIssue: PackManifestValidationIssue,
): PackManifestValidationIssue {
  return {
    code: validationIssue.code,
    field: validationIssue.field.replace(/^\$/, "pack"),
  };
}
