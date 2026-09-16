import { PackToolExecutionError } from "./fixture-harness-types.js";
import type { MCPatchDefinition } from "./mcpatch.js";
import type { JsonObject, JsonValue, PackFixture } from "./types.js";
import type { PackToolReturn } from "./tool-result.js";

const BROWSER_ERROR_CODES = new Set<BrowserToolErrorCode>([
  "CANCELLED",
  "EXECUTION_FAILED",
  "TOOL_UNAVAILABLE",
]);

export type BrowserToolErrorCode =
  "CANCELLED" | "EXECUTION_FAILED" | "TOOL_UNAVAILABLE";

/** Payload-free page error that the extension maps onto its page protocol. */
export class BrowserToolExecutionError extends Error {
  readonly code: BrowserToolErrorCode;

  constructor(code: BrowserToolErrorCode) {
    super(`browser tool failed: ${code}`);
    this.name = "BrowserToolExecutionError";
    this.code = code;
  }
}

/** Per-call browser context. The site object is created once for one document. */
export interface BrowserToolContext<TSite> {
  readonly site: TSite;
  readonly signal: AbortSignal;
}

export type BrowserToolHandler<
  TSite,
  TInput extends JsonObject = JsonObject,
  TOutput extends JsonValue = JsonValue,
> = (
  input: TInput,
  context: BrowserToolContext<TSite>,
) => PackToolReturn<TOutput> | Promise<PackToolReturn<TOutput>>;

export type BrowserToolAvailability<TSite> = (
  context: BrowserToolContext<TSite>,
) => boolean | Promise<boolean>;

export interface BrowserToolRuntimeOptions<TSite> {
  readonly available?: BrowserToolAvailability<TSite>;
}

export interface BrowserPackBuildOptions<TSite, TDocument> {
  readonly fixtures: readonly PackFixture[];
  readonly create: (document: TDocument) => TSite;
  readonly discover?: (
    context: BrowserToolContext<TSite>,
  ) => readonly string[] | Promise<readonly string[]>;
  readonly subscribe?: (
    site: TSite,
    listener: () => void,
  ) => undefined | (() => void);
}

export interface BrowserPageCapability {
  readonly source: "pack";
  readonly name: string;
}

export interface BrowserPageAdapter {
  capabilities(signal: AbortSignal): Promise<readonly BrowserPageCapability[]>;
  execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<PackToolReturn>;
  subscribe(listener: () => void): () => void;
}

export interface BrowserPageDefinition<TDocument> {
  readonly pack: MCPatchDefinition;
  readonly tools: readonly string[];
  readonly create: (document: TDocument) => BrowserPageAdapter;
}

/** One export contains both runtime-safe metadata and its reviewed page adapter. */
export interface BrowserPack<TDocument> {
  readonly definition: MCPatchDefinition;
  readonly page: BrowserPageDefinition<TDocument>;
}

export interface RegisteredBrowserTool<TSite> {
  readonly name: string;
  readonly available: BrowserToolAvailability<TSite> | undefined;
  readonly execute: BrowserToolHandler<TSite>;
}

export function createBrowserPageDefinition<TSite, TDocument>(
  definition: MCPatchDefinition,
  registrations: readonly RegisteredBrowserTool<TSite>[],
  create: (document: TDocument) => TSite,
  discover: BrowserPackBuildOptions<TSite, TDocument>["discover"],
  subscribe: BrowserPackBuildOptions<TSite, TDocument>["subscribe"],
): BrowserPageDefinition<TDocument> {
  const tools = Object.freeze(registrations.map((tool) => tool.name));
  return Object.freeze({
    pack: definition,
    tools,
    create: (document: TDocument) =>
      new GeneratedBrowserPageAdapter(
        create(document),
        registrations,
        discover,
        subscribe,
      ),
  });
}

export async function pageOnlyFallback(): Promise<never> {
  throw new PackToolExecutionError("TOOL_NOT_FOUND");
}

class GeneratedBrowserPageAdapter<TSite> implements BrowserPageAdapter {
  readonly #site: TSite;
  readonly #tools: readonly RegisteredBrowserTool<TSite>[];
  readonly #routes: ReadonlyMap<string, RegisteredBrowserTool<TSite>>;
  readonly #discover:
    BrowserPackBuildOptions<TSite, unknown>["discover"] | undefined;
  readonly #subscribe:
    BrowserPackBuildOptions<TSite, unknown>["subscribe"] | undefined;

  constructor(
    site: TSite,
    tools: readonly RegisteredBrowserTool<TSite>[],
    discover: BrowserPackBuildOptions<TSite, unknown>["discover"],
    subscribe: BrowserPackBuildOptions<TSite, unknown>["subscribe"],
  ) {
    this.#site = site;
    this.#tools = tools;
    this.#routes = new Map(tools.map((tool) => [tool.name, tool]));
    this.#discover = discover;
    this.#subscribe = subscribe;
  }

  async capabilities(
    signal: AbortSignal,
  ): Promise<readonly BrowserPageCapability[]> {
    abortIfNeeded(signal);
    try {
      const names =
        this.#discover === undefined
          ? await this.#discoverIndividually(signal)
          : copyDiscoveredNames(
              await this.#discover(this.#context(signal)),
              this.#routes,
            );
      abortIfNeeded(signal);
      return Object.freeze(
        names.map((name) => Object.freeze({ source: "pack" as const, name })),
      );
    } catch (error) {
      throw normalizeBrowserError(error, signal);
    }
  }

  async execute(
    toolName: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<PackToolReturn> {
    abortIfNeeded(signal);
    const tool = this.#routes.get(toolName);
    if (tool === undefined) {
      throw new BrowserToolExecutionError("TOOL_UNAVAILABLE");
    }
    try {
      if (!(await this.#isAvailable(tool, signal))) {
        throw new BrowserToolExecutionError("TOOL_UNAVAILABLE");
      }
      const result = await tool.execute(args, this.#context(signal));
      abortIfNeeded(signal);
      return result;
    } catch (error) {
      throw normalizeBrowserError(error, signal);
    }
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new BrowserToolExecutionError("EXECUTION_FAILED");
    }
    if (this.#subscribe === undefined) return () => undefined;
    try {
      const cleanup = this.#subscribe(this.#site, listener);
      if (cleanup !== undefined && typeof cleanup !== "function") {
        throw new BrowserToolExecutionError("EXECUTION_FAILED");
      }
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        cleanup?.();
      };
    } catch (error) {
      throw normalizeBrowserError(error);
    }
  }

  async #discoverIndividually(signal: AbortSignal): Promise<readonly string[]> {
    const names: string[] = [];
    for (const tool of this.#tools) {
      abortIfNeeded(signal);
      const available =
        tool.available === undefined
          ? true
          : await tool.available(this.#context(signal));
      if (typeof available !== "boolean") {
        throw new BrowserToolExecutionError("EXECUTION_FAILED");
      }
      if (available) names.push(tool.name);
    }
    return names;
  }

  async #isAvailable(
    tool: RegisteredBrowserTool<TSite>,
    signal: AbortSignal,
  ): Promise<boolean> {
    abortIfNeeded(signal);
    if (this.#discover !== undefined) {
      const names = copyDiscoveredNames(
        await this.#discover(this.#context(signal)),
        this.#routes,
      );
      return names.includes(tool.name);
    }
    if (tool.available === undefined) return true;
    const available = await tool.available(this.#context(signal));
    if (typeof available !== "boolean") {
      throw new BrowserToolExecutionError("EXECUTION_FAILED");
    }
    return available;
  }

  #context(signal: AbortSignal): BrowserToolContext<TSite> {
    return Object.freeze({ site: this.#site, signal });
  }
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new BrowserToolExecutionError("CANCELLED");
}

function normalizeBrowserError(
  error: unknown,
  signal?: AbortSignal,
): BrowserToolExecutionError {
  if (signal?.aborted === true) {
    return new BrowserToolExecutionError("CANCELLED");
  }
  if (error instanceof BrowserToolExecutionError) return error;
  const code = errorCode(error);
  return new BrowserToolExecutionError(code ?? "EXECUTION_FAILED");
}

function errorCode(error: unknown): BrowserToolErrorCode | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(error, "code");
  return descriptor !== undefined &&
    "value" in descriptor &&
    BROWSER_ERROR_CODES.has(descriptor.value as BrowserToolErrorCode)
    ? (descriptor.value as BrowserToolErrorCode)
    : undefined;
}

function copyDiscoveredNames<TSite>(
  value: readonly string[],
  routes: ReadonlyMap<string, RegisteredBrowserTool<TSite>>,
): readonly string[] {
  if (!Array.isArray(value) || value.length > routes.size) {
    throw new BrowserToolExecutionError("EXECUTION_FAILED");
  }
  const names: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    const name =
      descriptor !== undefined && "value" in descriptor
        ? descriptor.value
        : undefined;
    if (typeof name !== "string" || !routes.has(name) || seen.has(name)) {
      throw new BrowserToolExecutionError("EXECUTION_FAILED");
    }
    seen.add(name);
    names.push(name);
  }
  return Object.freeze(names);
}
