import type { JsonObject } from "@mcpatch/protocol";
import {
  canonicalizePageLocation,
  parseDeclarativePackBundleContent,
  type PackToolReturn,
} from "@mcpatch/sdk/runtime";

import { DeclarativeDomAdapter } from "./declarative-dom-adapter.js";
import { DeclarativeNavigationCoordinator } from "./declarative-navigation-coordinator.js";
import {
  createDeclarativePageAdapter,
  DeclarativePackRuntime,
  type DeclarativeRuntimeBinding,
} from "./declarative-pack-runtime.js";
import { LOCAL_PACK_TRUST } from "./local-pack-model.js";
import type { PageCapability } from "./page-channel.js";
import {
  PageAdapterExecutionError,
  type ChromePageClientRuntimeApi,
  type PageAdapter,
} from "./page-content-model.js";
import { emptyPageAdapter } from "./page-content-runtime.js";
import type { RealmNavigation } from "./realm-navigation.js";

const INSTALL_ID = /^local\.[a-f0-9]{32}$/u;
const MAX_LOCAL_PAGE_PACKS = 4;

export interface DeclarativePageSourceOptions {
  readonly contextPrefix: "local" | "registry";
  readonly installId: RegExp;
  readonly maximumPacks: number;
  readonly requestType:
    "community_pack_content_config" | "local_pack_content_config";
  readonly trust: ReadonlySet<string>;
}

/** Loads only the exact validated local programs selected by the worker. */
export async function loadLocalPackPageAdapter(
  runtime: ChromePageClientRuntimeApi,
  document: Document,
  location: Location,
  navigation?: RealmNavigation,
): Promise<PageAdapter> {
  return loadDeclarativePackPageAdapter(
    runtime,
    document,
    location,
    {
      contextPrefix: "local",
      installId: INSTALL_ID,
      maximumPacks: MAX_LOCAL_PAGE_PACKS,
      requestType: "local_pack_content_config",
      trust: new Set([LOCAL_PACK_TRUST]),
    },
    navigation,
  );
}

export async function loadDeclarativePackPageAdapter(
  runtime: ChromePageClientRuntimeApi,
  document: Document,
  location: Location,
  options: DeclarativePageSourceOptions,
  navigation?: RealmNavigation,
): Promise<PageAdapter> {
  if (runtime.sendMessage === undefined) return emptyPageAdapter;
  const page = canonicalizePageLocation(location.href);
  if (!page.ok) return emptyPageAdapter;
  let response: unknown;
  try {
    response = await runtime.sendMessage({ type: options.requestType });
  } catch {
    return emptyPageAdapter;
  }
  const records = contentRecords(response, options);
  if (records === undefined) return emptyPageAdapter;
  const adapters: PageAdapter[] = [];
  for (const [index, record] of records.entries()) {
    const binding: DeclarativeRuntimeBinding = Object.freeze({
      bundleDigest: record.bundle.manifest.digest,
      contextId: `${options.contextPrefix}.${record.installId.slice(`${options.contextPrefix}.`.length)}.${index}`,
      contextRevision: 1,
      documentId: `${options.contextPrefix}-document.${record.installId.slice(`${options.contextPrefix}.`.length)}`,
      origin: page.location.origin,
      path: page.location.path,
      tabId: 0,
    });
    try {
      const declarative = await DeclarativePackRuntime.create({
        binding,
        bundle: record.bundle,
        currentBinding() {
          const current = canonicalizePageLocation(location.href);
          return current.ok &&
            current.location.origin === binding.origin &&
            current.location.path === binding.path
            ? binding
            : undefined;
        },
        document: new DeclarativeDomAdapter(document),
        ...(navigation === undefined
          ? {}
          : {
              navigation: new DeclarativeNavigationCoordinator(
                record.bundle.manifest,
                navigation,
              ),
            }),
      });
      adapters.push(createDeclarativePageAdapter(declarative));
    } catch {
      closeAll(adapters);
      return emptyPageAdapter;
    }
  }
  return adapters.length === 0
    ? emptyPageAdapter
    : new CompositePageAdapter(adapters);
}

/** Native capabilities win exact-name collisions; ambiguous packs stay hidden. */
export class CompositePageAdapter implements PageAdapter {
  readonly #adapters: readonly PageAdapter[];
  #routes = new Map<string, PageAdapter>();
  #subscribed = false;

  constructor(adapters: readonly PageAdapter[]) {
    if (!Array.isArray(adapters) || adapters.length === 0) {
      throw new TypeError("composite page adapters were rejected");
    }
    this.#adapters = Object.freeze([...adapters]);
  }

  authorizePackTools(tools: readonly string[]): void {
    for (const adapter of this.#adapters) adapter.authorizePackTools?.(tools);
  }

  bindContextRevocation(revoke: () => void): void {
    for (const adapter of this.#adapters) {
      adapter.bindContextRevocation?.(revoke);
    }
  }

  async capabilities(signal: AbortSignal): Promise<readonly PageCapability[]> {
    const nativeCapabilities: PageCapability[] = [];
    const packCapabilities = new Map<string, PageCapability>();
    const routes = new Map<string, PageAdapter>();
    const nativeNames = new Set<string>();
    const packOwners = new Map<string, PageAdapter | undefined>();
    for (const adapter of this.#adapters) {
      const discovered = await adapter.capabilities(signal);
      for (const capability of discovered) {
        if (capability.source === "native_webmcp") {
          if (nativeNames.has(capability.name)) {
            throw new PageAdapterExecutionError("EXECUTION_FAILED");
          }
          nativeNames.add(capability.name);
          nativeCapabilities.push(capability);
          routes.set(capability.name, adapter);
          continue;
        }
        const previous = packOwners.get(capability.name);
        if (!packOwners.has(capability.name)) {
          packOwners.set(capability.name, adapter);
          packCapabilities.set(capability.name, capability);
        } else if (previous !== adapter) {
          packOwners.set(capability.name, undefined);
          packCapabilities.delete(capability.name);
        }
      }
    }
    for (const [name, owner] of packOwners) {
      if (owner !== undefined && !nativeNames.has(name))
        routes.set(name, owner);
    }
    this.#routes = routes;
    return Object.freeze([
      ...nativeCapabilities,
      ...[...packCapabilities.values()].filter(
        (capability) => !nativeNames.has(capability.name),
      ),
    ]);
  }

  execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<PackToolReturn> {
    const route = this.#routes.get(tool);
    if (route === undefined) {
      throw new PageAdapterExecutionError("TOOL_UNAVAILABLE");
    }
    return route.execute(tool, args, signal);
  }

  subscribe(listener: () => void): () => void {
    if (this.#subscribed)
      throw new TypeError("page adapter already subscribed");
    const unsubscribes: Array<() => void> = [];
    try {
      for (const adapter of this.#adapters) {
        const unsubscribe = adapter.subscribe?.(() => {
          listener();
        });
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

  close(): void {
    this.#routes.clear();
    this.#subscribed = false;
    closeAll(this.#adapters);
  }
}

function contentRecords(
  response: unknown,
  options: DeclarativePageSourceOptions,
):
  | readonly {
      readonly installId: string;
      readonly bundle: ReturnType<typeof parseDeclarativePackBundleContent>;
    }[]
  | undefined {
  if (!dataObject(response, ["ok", "value"]) || response.ok !== true) {
    return undefined;
  }
  if (
    !Array.isArray(response.value) ||
    response.value.length > options.maximumPacks
  ) {
    return undefined;
  }
  const records = [];
  for (const value of response.value) {
    if (
      !dataObject(value, ["installId", "trust", "bundle"]) ||
      typeof value.installId !== "string" ||
      !options.installId.test(value.installId) ||
      typeof value.trust !== "string" ||
      !options.trust.has(value.trust)
    ) {
      return undefined;
    }
    try {
      records.push(
        Object.freeze({
          installId: value.installId,
          bundle: parseDeclarativePackBundleContent(value.bundle),
        }),
      );
    } catch {
      return undefined;
    }
  }
  return Object.freeze(records);
}

function dataObject(
  value: unknown,
  fields: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === fields.length &&
    keys.every((key) => typeof key === "string" && fields.includes(key)) &&
    fields.every((field) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, field);
      return descriptor !== undefined && "value" in descriptor;
    })
  );
}

function closeAll(adapters: readonly PageAdapter[]): void {
  for (const adapter of adapters) {
    try {
      adapter.close?.();
    } catch {
      // The composite removes all routes regardless of child cleanup errors.
    }
  }
}

function unsubscribeAll(unsubscribes: readonly (() => void)[]): void {
  for (const unsubscribe of unsubscribes) {
    try {
      unsubscribe();
    } catch {
      // Subscription authority has already been removed from the composite.
    }
  }
}
