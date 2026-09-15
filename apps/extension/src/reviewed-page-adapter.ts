import type { JsonObject, JsonValue } from "@mcpatch/protocol";
import {
  canonicalizePageLocation,
  packMatchesLocation,
  type PackManifest,
} from "@mcpatch/sdk/runtime";

import type { PageCapability } from "./page-channel.js";
import {
  PageAdapterExecutionError,
  type PageAdapter,
} from "./page-content-model.js";
import {
  validateCompiledPacks,
  validateRuntimeOptions,
  type CompiledPackRuntimeOptions,
  type CompiledPackSubject,
} from "./compiled-pack-validation.js";

const MAX_REVIEWED_PAGE_ADAPTERS = 32;
const MAX_PAGE_ADAPTER_TOOLS = 128;
const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;

export interface ReviewedPageAdapterDefinition {
  readonly pack: CompiledPackSubject;
  readonly tools: readonly string[];
  readonly create: (document: Document) => PageAdapter;
}

interface ReviewedPageAdapterEntry {
  readonly manifest: PackManifest;
  readonly tools: ReadonlySet<string>;
  readonly create: ReviewedPageAdapterDefinition["create"];
}

interface ActivePackAdapter {
  readonly adapter: PageAdapter;
  readonly tools: ReadonlySet<string>;
}

/** Creates one document-local router from static reviewed definitions. */
export function createReviewedDocumentAdapter(
  document: Document,
  url: string,
  definitions: readonly ReviewedPageAdapterDefinition[],
  options: CompiledPackRuntimeOptions,
  native?: PageAdapter,
): PageAdapter {
  const entries = validateDefinitions(definitions, options);
  const page = canonicalizePageLocation(url);
  const matching = page.ok
    ? entries.filter((entry) =>
        packMatchesLocation(entry.manifest, page.location),
      )
    : [];
  return new ReviewedDocumentAdapter(document, matching, native);
}

class ReviewedDocumentAdapter implements PageAdapter {
  readonly #document: Document;
  readonly #entries: readonly ReviewedPageAdapterEntry[];
  readonly #native: PageAdapter | undefined;
  #packs: readonly ActivePackAdapter[] = Object.freeze([]);
  #routes = new Map<string, PageAdapter>();
  #subscribed = false;

  constructor(
    document: Document,
    entries: readonly ReviewedPageAdapterEntry[],
    native: PageAdapter | undefined,
  ) {
    this.#document = document;
    this.#entries = entries;
    this.#native = native;
  }

  authorizePackTools(tools: readonly string[]): void {
    if (this.#subscribed) {
      throw new TypeError("page adapter authorization is already active");
    }
    const authorized = validateAuthorization(tools);
    const selected: ReviewedPageAdapterEntry[] = [];
    const declared = new Set<string>();
    for (const entry of this.#entries) {
      const overlap = [...entry.tools].filter((tool) => authorized.has(tool));
      if (overlap.length === 0) continue;
      if (overlap.length !== entry.tools.size) {
        throw new TypeError("reviewed page adapter authorization is partial");
      }
      for (const tool of entry.tools) {
        if (declared.has(tool)) {
          throw new TypeError("reviewed page adapter tool is ambiguous");
        }
        declared.add(tool);
      }
      selected.push(entry);
    }

    const packs: ActivePackAdapter[] = [];
    for (const entry of selected) {
      let adapter: PageAdapter;
      try {
        adapter = entry.create(this.#document);
        validateAdapter(adapter);
      } catch {
        throw new TypeError("reviewed page adapter factory failed");
      }
      packs.push(Object.freeze({ adapter, tools: entry.tools }));
    }
    this.#packs = Object.freeze(packs);
    this.#routes.clear();
  }

  async capabilities(signal: AbortSignal): Promise<readonly PageCapability[]> {
    abortIfNeeded(signal);
    const capabilities: PageCapability[] = [];
    const routes = new Map<string, PageAdapter>();
    if (this.#native !== undefined) {
      const nativeCapabilities = await discover(this.#native, signal);
      for (const capability of nativeCapabilities) {
        if (capability.source !== "native_webmcp") adapterFailed();
        if (routes.has(capability.name)) adapterFailed();
        routes.set(capability.name, this.#native);
        capabilities.push(capability);
      }
    }
    for (const pack of this.#packs) {
      const packCapabilities = await discover(pack.adapter, signal);
      for (const capability of packCapabilities) {
        if (
          capability.source !== "pack" ||
          !pack.tools.has(capability.name) ||
          capabilities.some(
            (candidate) =>
              candidate.source === "pack" && candidate.name === capability.name,
          )
        ) {
          adapterFailed();
        }
        if (!routes.has(capability.name)) {
          routes.set(capability.name, pack.adapter);
        }
        capabilities.push(capability);
        if (capabilities.length > MAX_PAGE_ADAPTER_TOOLS) adapterFailed();
      }
    }
    abortIfNeeded(signal);
    this.#routes = routes;
    return Object.freeze(capabilities);
  }

  async execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const adapter = this.#routes.get(tool);
    if (adapter === undefined) {
      throw new PageAdapterExecutionError("TOOL_UNAVAILABLE");
    }
    return adapter.execute(tool, args, signal);
  }

  subscribe(listener: () => void): () => void {
    if (this.#subscribed) {
      throw new TypeError("page adapter already has a subscriber");
    }
    const unsubscribes: Array<() => void> = [];
    const changed = () => {
      this.#routes.clear();
      listener();
    };
    try {
      for (const adapter of this.#adapters()) {
        const unsubscribe = adapter.subscribe?.(changed);
        if (unsubscribe !== undefined) unsubscribes.push(unsubscribe);
      }
    } catch {
      unsubscribeAll(unsubscribes);
      throw new PageAdapterExecutionError("EXECUTION_FAILED");
    }
    this.#subscribed = true;
    return () => {
      if (!this.#subscribed) return;
      this.#subscribed = false;
      this.#routes.clear();
      unsubscribeAll(unsubscribes);
    };
  }

  #adapters(): readonly PageAdapter[] {
    return [
      ...(this.#native === undefined ? [] : [this.#native]),
      ...this.#packs.map((pack) => pack.adapter),
    ];
  }
}

async function discover(
  adapter: PageAdapter,
  signal: AbortSignal,
): Promise<readonly PageCapability[]> {
  abortIfNeeded(signal);
  let capabilities: readonly PageCapability[];
  try {
    capabilities = await adapter.capabilities(signal);
  } catch (error) {
    if (error instanceof PageAdapterExecutionError) throw error;
    adapterFailed();
  }
  abortIfNeeded(signal);
  if (
    !Array.isArray(capabilities) ||
    capabilities.length > MAX_PAGE_ADAPTER_TOOLS
  ) {
    adapterFailed();
  }
  return capabilities;
}

function validateDefinitions(
  definitions: readonly ReviewedPageAdapterDefinition[],
  options: CompiledPackRuntimeOptions,
): readonly ReviewedPageAdapterEntry[] {
  const checkedOptions = validateRuntimeOptions(options);
  if (
    checkedOptions === undefined ||
    !Array.isArray(definitions) ||
    definitions.length > MAX_REVIEWED_PAGE_ADAPTERS
  ) {
    throw new TypeError("reviewed page adapter definitions were rejected");
  }
  const values = definitions.map(readDefinition);
  if (values.some((value) => value === undefined)) {
    throw new TypeError("reviewed page adapter definitions were rejected");
  }
  const checkedValues = values as Array<{
    readonly pack: CompiledPackSubject;
    readonly tools: readonly string[];
    readonly create: ReviewedPageAdapterDefinition["create"];
  }>;
  const packs = validateCompiledPacks(
    checkedValues.map((value) => value.pack),
    checkedOptions,
  );
  if (packs === undefined) {
    throw new TypeError("reviewed page adapter definitions were rejected");
  }
  return Object.freeze(
    checkedValues.map((value, index) => {
      const pack = packs[index];
      if (pack === undefined) {
        throw new TypeError("reviewed page adapter pack is missing");
      }
      const manifestTools = new Set(
        pack.manifest.tools.map((tool) => tool.name),
      );
      if (
        value.tools.length === 0 ||
        value.tools.length > MAX_PAGE_ADAPTER_TOOLS ||
        new Set(value.tools).size !== value.tools.length ||
        value.tools.some((tool) => !manifestTools.has(tool))
      ) {
        throw new TypeError("reviewed page adapter tools were rejected");
      }
      return Object.freeze({
        manifest: pack.manifest,
        tools: Object.freeze(new Set(value.tools)),
        create: value.create,
      });
    }),
  );
}

function readDefinition(value: unknown):
  | {
      readonly pack: CompiledPackSubject;
      readonly tools: readonly string[];
      readonly create: ReviewedPageAdapterDefinition["create"];
    }
  | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 3 ||
    keys.some(
      (key) =>
        typeof key !== "string" || !["pack", "tools", "create"].includes(key),
    )
  ) {
    return undefined;
  }
  const pack = dataProperty(value, "pack");
  const tools = dataProperty(value, "tools");
  const create = dataProperty(value, "create");
  if (!Array.isArray(tools) || typeof create !== "function") return undefined;
  const copiedTools: string[] = [];
  for (let index = 0; index < tools.length; index += 1) {
    const tool = dataProperty(tools, String(index));
    if (
      typeof tool !== "string" ||
      tool.length > 128 ||
      !TOOL_NAME.test(tool)
    ) {
      return undefined;
    }
    copiedTools.push(tool);
  }
  return {
    pack: pack as CompiledPackSubject,
    tools: Object.freeze(copiedTools),
    create: create as ReviewedPageAdapterDefinition["create"],
  };
}

function dataProperty(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function validateAuthorization(tools: readonly string[]): ReadonlySet<string> {
  if (
    !Array.isArray(tools) ||
    tools.length > MAX_PAGE_ADAPTER_TOOLS ||
    tools.some(
      (tool) =>
        typeof tool !== "string" || tool.length > 128 || !TOOL_NAME.test(tool),
    ) ||
    new Set(tools).size !== tools.length
  ) {
    throw new TypeError("page adapter authorization was rejected");
  }
  for (let index = 1; index < tools.length; index += 1) {
    if ((tools[index - 1] as string) >= (tools[index] as string)) {
      throw new TypeError("page adapter authorization was rejected");
    }
  }
  return new Set(tools);
}

function validateAdapter(adapter: PageAdapter): void {
  if (
    typeof adapter !== "object" ||
    adapter === null ||
    typeof adapter.capabilities !== "function" ||
    typeof adapter.execute !== "function" ||
    (adapter.subscribe !== undefined && typeof adapter.subscribe !== "function")
  ) {
    throw new TypeError("invalid reviewed page adapter");
  }
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) throw new PageAdapterExecutionError("CANCELLED");
}

function adapterFailed(): never {
  throw new PageAdapterExecutionError("EXECUTION_FAILED");
}

function unsubscribeAll(unsubscribes: readonly (() => void)[]): void {
  for (const unsubscribe of [...unsubscribes].reverse()) {
    try {
      unsubscribe();
    } catch {
      // Cleanup is best-effort after routes have already been revoked.
    }
  }
}
