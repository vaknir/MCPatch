import { authoringObject, reject } from "./authoring-validation.js";
import {
  createBrowserPageDefinition,
  pageOnlyFallback,
  type BrowserPack,
  type BrowserPackBuildOptions,
  type BrowserToolAvailability,
  type BrowserToolHandler,
  type BrowserToolRuntimeOptions,
  type RegisteredBrowserTool,
} from "./browser-page.js";
import {
  MCPatch as CoreMCPatch,
  type MCPatchOptions,
  type MCPatchToolOptions,
} from "./mcpatch.js";
import type { InferPackInput, InferPackOutput } from "./schema-inference.js";
import type {
  JsonObject,
  PackCompatibility,
  PackNetworkPolicy,
  PackPermission,
  PackRisk,
} from "./types.js";
import { issue } from "./validation/primitives.js";

export { BrowserToolExecutionError } from "./browser-page.js";
export type {
  BrowserPack,
  BrowserPackBuildOptions,
  BrowserPageAdapter,
  BrowserPageCapability,
  BrowserPageDefinition,
  BrowserToolAvailability,
  BrowserToolContext,
  BrowserToolErrorCode,
  BrowserToolHandler,
  BrowserToolRuntimeOptions,
} from "./browser-page.js";

const MAX_TOOLS = 128;
const PACK_OPTION_FIELDS = [
  "publisher",
  "id",
  "name",
  "description",
  "version",
  "digest",
  "matches",
  "compatibility",
  "networkPolicy",
] as const;
const BROWSER_TOOL_FIELDS = [
  "name",
  "title",
  "description",
  "risk",
  "permissions",
  "inputSchema",
  "outputSchema",
] as const;
const DEFAULT_COMPATIBILITY: PackCompatibility = Object.freeze({
  runtime: Object.freeze({ minimum: "0.1.0", maximumExclusive: "0.2.0" }),
  bridgeProtocol: Object.freeze({ minimum: 2, maximum: 2 }),
});

/** Fixed-safe browser pack metadata; protocol and deny-network defaults are added. */
export type BrowserMCPatchOptions = Omit<
  MCPatchOptions,
  "compatibility" | "execution" | "manifestVersion" | "networkPolicy"
> & {
  readonly compatibility?: PackCompatibility;
  readonly networkPolicy?: PackNetworkPolicy;
};

/** A risk's baseline permission is inferred unless extra permissions are explicit. */
export type BrowserToolMetadata<
  TName extends string,
  TInputSchema extends JsonObject,
  TOutputSchema extends JsonObject,
> = Omit<
  MCPatchToolOptions<TName, TInputSchema, TOutputSchema>,
  "permissions"
> & {
  readonly permissions?: readonly PackPermission[];
};

/**
 * FastMCP-style authoring for reviewed page-backed packs.
 *
 * Tool declarations generate both the data-only compiled definition used by the
 * service worker and the exact document-local router used by the content runtime.
 */
export class MCPatch<TSite, TDocument = Document> {
  readonly #core: CoreMCPatch;
  readonly #tools: RegisteredBrowserTool<TSite>[] = [];

  constructor(options: BrowserMCPatchOptions) {
    const source = authoringObject(
      options,
      PACK_OPTION_FIELDS,
      new Set(["compatibility", "networkPolicy"]),
      "browserPack",
    );
    this.#core = new CoreMCPatch({
      manifestVersion: 1,
      publisher: source.publisher as string,
      id: source.id as string,
      name: source.name as string,
      description: source.description as string,
      version: source.version as string,
      digest: source.digest as string,
      compatibility:
        (source.compatibility as PackCompatibility | undefined) ??
        DEFAULT_COMPATIBILITY,
      execution: { kind: "bundled" },
      matches: source.matches as MCPatchOptions["matches"],
      networkPolicy:
        (source.networkPolicy as PackNetworkPolicy | undefined) ??
        ({ extensionRequests: "none" } as const),
    });
  }

  /** Registers a real browser handler and returns it for direct unit testing. */
  tool<
    const TName extends string,
    const TInputSchema extends JsonObject,
    const TOutputSchema extends JsonObject,
    const TRisk extends PackRisk,
  >(
    metadata: BrowserToolMetadata<TName, TInputSchema, TOutputSchema> & {
      readonly risk: TRisk;
    },
    handler: BrowserToolHandler<
      TSite,
      InferPackInput<TInputSchema>,
      InferPackOutput<TOutputSchema>,
      TRisk
    >,
    runtime: BrowserToolRuntimeOptions<TSite> = {},
  ): typeof handler {
    const metadataSource = authoringObject(
      metadata,
      BROWSER_TOOL_FIELDS,
      new Set(["permissions", "title"]),
      "tool",
    );
    const runtimeSource = authoringObject(
      runtime,
      ["available"],
      new Set(["available"]),
      "browserTool",
    );
    if (typeof handler !== "function") {
      reject(issue("INVALID_TYPE", "browserTool.execute"));
    }
    const available = runtimeSource.available;
    if (available !== undefined && typeof available !== "function") {
      reject(issue("INVALID_TYPE", "browserTool.available"));
    }
    if (this.#tools.length >= MAX_TOOLS) {
      reject(issue("LIMIT_EXCEEDED", "tools"));
    }

    const permissions =
      (metadataSource.permissions as readonly PackPermission[] | undefined) ??
      defaultPermissions(metadataSource.risk);
    this.#core.tool(
      {
        ...metadataSource,
        permissions,
      } as MCPatchToolOptions<TName, TInputSchema, TOutputSchema>,
      pageOnlyFallback,
    );
    this.#tools.push(
      Object.freeze({
        name: metadataSource.name as string,
        risk: metadataSource.risk as PackRisk,
        available: available as BrowserToolAvailability<TSite> | undefined,
        execute: handler as unknown as RegisteredBrowserTool<TSite>["execute"],
      }),
    );
    return handler;
  }

  /** Finalizes one object for both the service worker and page content runtime. */
  build(
    options: BrowserPackBuildOptions<TSite, TDocument>,
  ): BrowserPack<TDocument> {
    const source = authoringObject(
      options,
      ["fixtures", "create", "discover", "subscribe"],
      new Set(["discover", "subscribe"]),
      "browserPack",
    );
    if (typeof source.create !== "function") {
      reject(issue("INVALID_TYPE", "browserPack.create"));
    }
    if (
      source.discover !== undefined &&
      typeof source.discover !== "function"
    ) {
      reject(issue("INVALID_TYPE", "browserPack.discover"));
    }
    if (
      source.subscribe !== undefined &&
      typeof source.subscribe !== "function"
    ) {
      reject(issue("INVALID_TYPE", "browserPack.subscribe"));
    }
    if (
      source.discover !== undefined &&
      this.#tools.some((tool) => tool.available !== undefined)
    ) {
      reject(issue("INVALID_VALUE", "browserPack.discover"));
    }

    const definition = this.#core.build({
      fixtures: source.fixtures as BrowserPackBuildOptions<
        TSite,
        TDocument
      >["fixtures"],
    });
    const registrations = Object.freeze([...this.#tools]);
    const create = source.create as BrowserPackBuildOptions<
      TSite,
      TDocument
    >["create"];
    const discover = source.discover as
      BrowserPackBuildOptions<TSite, TDocument>["discover"] | undefined;
    const subscribe = source.subscribe as
      BrowserPackBuildOptions<TSite, TDocument>["subscribe"] | undefined;
    const page = createBrowserPageDefinition(
      definition,
      registrations,
      create,
      discover,
      subscribe,
    );
    return Object.freeze({ definition, page });
  }
}

function defaultPermissions(risk: unknown): readonly PackPermission[] {
  switch (risk) {
    case "read":
      return Object.freeze(["READ"]);
    case "action":
      return Object.freeze(["ACTION"]);
    case "sensitive":
      return Object.freeze(["SENSITIVE"]);
    default:
      reject(issue("INVALID_PERMISSION", "tool.risk"));
  }
}
