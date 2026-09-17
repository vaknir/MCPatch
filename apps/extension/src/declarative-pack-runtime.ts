import type { JsonObject, JsonValue } from "@mcpatch/protocol";
import {
  canonicalizePageLocation,
  computeDeclarativePackBundleDigest,
  packMatchesLocation,
  parseDeclarativePackBundleContent,
  parseDeclarativePackBundle,
  type DeclarativeOperation,
  type DeclarativePackBundle,
  type DeclarativePackBundleContent,
  type PackToolManifest,
} from "@mcpatch/sdk/runtime";

import type { PageCapability } from "./page-channel.js";
import {
  PageAdapterExecutionError,
  type PageAdapter,
} from "./page-content-model.js";
import type { DeclarativeDocumentAdapter } from "./declarative-document-model.js";
import { DeclarativeRuntimeError } from "./declarative-document-model.js";
import {
  DEFAULT_DECLARATIVE_RUNTIME_LIMITS,
  DeclarativeExecutionBudget,
  withExecutionDeadline,
  type DeclarativeRuntimeLimits,
} from "./declarative-execution-budget.js";
import {
  discoverDeclarativeOperation,
  executeDeclarativeOperation,
} from "./declarative-interpreter.js";

const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u;

export interface DeclarativeRuntimeBinding {
  readonly bundleDigest: string;
  readonly contextId: string;
  readonly contextRevision: number;
  readonly documentId: string;
  readonly origin: string;
  readonly path: string;
  readonly tabId: number;
}

export interface DeclarativePackRuntimeOptions {
  readonly binding: DeclarativeRuntimeBinding;
  readonly bundle: unknown;
  readonly currentBinding: () => DeclarativeRuntimeBinding | undefined;
  readonly document: DeclarativeDocumentAdapter;
  readonly limits?: Partial<DeclarativeRuntimeLimits>;
}

interface RuntimeTool {
  readonly manifest: PackToolManifest;
  readonly operation: DeclarativeOperation;
}

type RuntimeBundle = DeclarativePackBundle | DeclarativePackBundleContent;

/** One validated bundle bound to one exact browser document and route. */
export class DeclarativePackRuntime {
  readonly #binding: DeclarativeRuntimeBinding;
  readonly #bundle: RuntimeBundle;
  readonly #currentBinding: () => DeclarativeRuntimeBinding | undefined;
  readonly #document: DeclarativeDocumentAdapter;
  readonly #limits: DeclarativeRuntimeLimits;
  readonly #tools: ReadonlyMap<string, RuntimeTool>;
  readonly #active = new Set<AbortController>();
  #revoked = false;

  private constructor(
    options: DeclarativePackRuntimeOptions,
    bundle: RuntimeBundle,
    limits: DeclarativeRuntimeLimits,
  ) {
    this.#binding = freezeBinding(options.binding);
    this.#bundle = bundle;
    this.#currentBinding = options.currentBinding;
    this.#document = options.document;
    this.#limits = limits;
    this.#tools = operationMap(bundle);
  }

  static async create(
    options: DeclarativePackRuntimeOptions,
  ): Promise<DeclarativePackRuntime> {
    let bundle: RuntimeBundle;
    try {
      bundle = parseRuntimeBundle(options.bundle);
    } catch {
      throw new DeclarativeRuntimeError("STALE_CONTEXT");
    }
    const binding = freezeBinding(options.binding);
    let digest: string;
    try {
      digest = await computeDeclarativePackBundleDigest(bundle);
    } catch {
      throw new DeclarativeRuntimeError("INTERNAL_ERROR");
    }
    if (
      digest !== bundle.manifest.digest ||
      digest !== binding.bundleDigest ||
      !bindingMatchesManifest(binding, bundle)
    ) {
      throw new DeclarativeRuntimeError("STALE_CONTEXT");
    }
    const limits = validateLimits(options.limits);
    const runtime = new DeclarativePackRuntime(options, bundle, limits);
    runtime.#assertCurrent();
    return runtime;
  }

  get binding(): DeclarativeRuntimeBinding {
    return this.#binding;
  }

  async capabilities(signal: AbortSignal): Promise<readonly PageCapability[]> {
    return this.#run(signal, async (budget) => {
      const capabilities: PageCapability[] = [];
      for (const [name, tool] of this.#tools) {
        if (
          await discoverDeclarativeOperation(
            tool.operation,
            this.#document,
            budget,
          )
        ) {
          capabilities.push(Object.freeze({ source: "pack", name }));
        }
      }
      return Object.freeze(capabilities);
    });
  }

  async execute(
    toolName: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    if (!emptyDataObject(args)) {
      throw new DeclarativeRuntimeError("INVALID_PAGE_VALUE");
    }
    const tool = this.#tools.get(toolName);
    if (tool === undefined) {
      throw new DeclarativeRuntimeError("CAPABILITY_UNAVAILABLE");
    }
    return this.#run(signal, (budget) =>
      executeDeclarativeOperation(
        tool.operation,
        tool.manifest.outputSchema,
        this.#document,
        budget,
      ),
    );
  }

  revoke(): void {
    if (this.#revoked) return;
    this.#revoked = true;
    const reason = new DeclarativeRuntimeError("STALE_CONTEXT");
    for (const controller of this.#active) controller.abort(reason);
    this.#active.clear();
  }

  async #run<T>(
    outerSignal: AbortSignal,
    execute: (budget: DeclarativeExecutionBudget) => Promise<T>,
  ): Promise<T> {
    this.#assertCurrent();
    const controller = new AbortController();
    const abort = () => controller.abort(outerSignal.reason);
    outerSignal.addEventListener("abort", abort, { once: true });
    if (outerSignal.aborted) abort();
    this.#active.add(controller);
    try {
      return await withExecutionDeadline(
        controller.signal,
        this.#limits.deadlineMs,
        async (signal) => {
          await this.#revalidate(signal);
          const budget = new DeclarativeExecutionBudget(
            this.#limits,
            signal,
            () => this.#assertCurrent(),
          );
          const value = await execute(budget);
          budget.check();
          return value;
        },
      );
    } finally {
      outerSignal.removeEventListener("abort", abort);
      this.#active.delete(controller);
      controller.abort();
    }
  }

  async #revalidate(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    try {
      parseRuntimeBundle(this.#bundle);
    } catch {
      throw new DeclarativeRuntimeError("STALE_CONTEXT");
    }
    let digest: string;
    try {
      digest = await computeDeclarativePackBundleDigest(this.#bundle);
    } catch {
      throw new DeclarativeRuntimeError("INTERNAL_ERROR");
    }
    signal.throwIfAborted();
    if (digest !== this.#binding.bundleDigest) {
      throw new DeclarativeRuntimeError("STALE_CONTEXT");
    }
    this.#assertCurrent();
  }

  #assertCurrent(): void {
    if (
      this.#revoked ||
      !sameBinding(this.#binding, safeCurrentBinding(this.#currentBinding))
    ) {
      throw new DeclarativeRuntimeError("STALE_CONTEXT");
    }
  }
}

export function createDeclarativePageAdapter(
  runtime: DeclarativePackRuntime,
): PageAdapter {
  let authorized = new Set<string>();
  return {
    authorizePackTools(tools) {
      if (
        !Array.isArray(tools) ||
        tools.length > 128 ||
        new Set(tools).size !== tools.length ||
        tools.some((tool) => typeof tool !== "string" || !TOOL_NAME.test(tool))
      ) {
        throw new TypeError("declarative tool authorization was rejected");
      }
      authorized = new Set(tools);
    },
    async capabilities(signal) {
      try {
        const discovered = await runtime.capabilities(signal);
        return discovered.filter((capability) =>
          authorized.has(capability.name),
        );
      } catch (error) {
        throw pageError(error);
      }
    },
    close() {
      authorized.clear();
      runtime.revoke();
    },
    async execute(tool, args, signal) {
      if (!authorized.has(tool)) {
        throw new PageAdapterExecutionError("TOOL_UNAVAILABLE");
      }
      try {
        return await runtime.execute(tool, args, signal);
      } catch (error) {
        throw pageError(error);
      }
    },
  };
}

function operationMap(bundle: RuntimeBundle): ReadonlyMap<string, RuntimeTool> {
  const manifests = new Map(
    bundle.manifest.tools.map((tool) => [tool.name, tool]),
  );
  const tools = new Map<string, RuntimeTool>();
  for (const operation of bundle.operations.program.operations) {
    const manifest = manifests.get(operation.tool);
    if (manifest === undefined || tools.has(operation.tool)) {
      throw new DeclarativeRuntimeError("INTERNAL_ERROR");
    }
    tools.set(operation.tool, Object.freeze({ manifest, operation }));
  }
  return tools;
}

function validateLimits(
  overrides: Partial<DeclarativeRuntimeLimits> | undefined,
): DeclarativeRuntimeLimits {
  if (
    overrides !== undefined &&
    Object.keys(overrides).some(
      (key) => !Object.hasOwn(DEFAULT_DECLARATIVE_RUNTIME_LIMITS, key),
    )
  ) {
    throw new TypeError("declarative runtime limits were rejected");
  }
  const limits = Object.freeze({
    ...DEFAULT_DECLARATIVE_RUNTIME_LIMITS,
    ...overrides,
  });
  for (const [key, value] of Object.entries(limits)) {
    const maximum =
      DEFAULT_DECLARATIVE_RUNTIME_LIMITS[key as keyof DeclarativeRuntimeLimits];
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new TypeError("declarative runtime limits were rejected");
    }
  }
  return limits;
}

function freezeBinding(
  value: DeclarativeRuntimeBinding,
): DeclarativeRuntimeBinding {
  if (
    !Number.isSafeInteger(value.tabId) ||
    value.tabId < 0 ||
    !Number.isSafeInteger(value.contextRevision) ||
    value.contextRevision < 1 ||
    typeof value.contextId !== "string" ||
    value.contextId.length === 0 ||
    value.contextId.length > 128 ||
    typeof value.documentId !== "string" ||
    value.documentId.length === 0 ||
    value.documentId.length > 128 ||
    typeof value.bundleDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(value.bundleDigest)
  ) {
    throw new DeclarativeRuntimeError("STALE_CONTEXT");
  }
  const page = canonicalizePageLocation(`${value.origin}${value.path}`);
  if (
    !page.ok ||
    page.location.origin !== value.origin ||
    page.location.path !== value.path
  ) {
    throw new DeclarativeRuntimeError("STALE_CONTEXT");
  }
  return Object.freeze({ ...value });
}

function bindingMatchesManifest(
  binding: DeclarativeRuntimeBinding,
  bundle: RuntimeBundle,
): boolean {
  const page = canonicalizePageLocation(`${binding.origin}${binding.path}`);
  return page.ok && packMatchesLocation(bundle.manifest, page.location);
}

function parseRuntimeBundle(value: unknown): RuntimeBundle {
  if (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "publisherSignature")
  ) {
    return parseDeclarativePackBundle(value);
  }
  return parseDeclarativePackBundleContent(value);
}

function safeCurrentBinding(
  read: () => DeclarativeRuntimeBinding | undefined,
): DeclarativeRuntimeBinding | undefined {
  try {
    const value = read();
    return value === undefined ? undefined : freezeBinding(value);
  } catch {
    return undefined;
  }
}

function sameBinding(
  expected: DeclarativeRuntimeBinding,
  actual: DeclarativeRuntimeBinding | undefined,
): boolean {
  return (
    actual !== undefined &&
    expected.bundleDigest === actual.bundleDigest &&
    expected.contextId === actual.contextId &&
    expected.contextRevision === actual.contextRevision &&
    expected.documentId === actual.documentId &&
    expected.origin === actual.origin &&
    expected.path === actual.path &&
    expected.tabId === actual.tabId
  );
}

function emptyDataObject(value: JsonObject): boolean {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return (
    (prototype === Object.prototype || prototype === null) &&
    Reflect.ownKeys(value).length === 0
  );
}

function pageError(error: unknown): PageAdapterExecutionError {
  if (!(error instanceof DeclarativeRuntimeError)) {
    return new PageAdapterExecutionError("EXECUTION_FAILED");
  }
  switch (error.code) {
    case "CANCELLED":
      return new PageAdapterExecutionError("CANCELLED");
    case "CAPABILITY_UNAVAILABLE":
    case "PROJECTION_ABSENT":
    case "STALE_CONTEXT":
      return new PageAdapterExecutionError("TOOL_UNAVAILABLE");
    case "INVALID_PAGE_VALUE":
    case "OUTPUT_LIMIT_EXCEEDED":
    case "RESULT_INVALID":
    case "TEXT_LIMIT_EXCEEDED":
    case "ATTRIBUTE_LIMIT_EXCEEDED":
      return new PageAdapterExecutionError("RESULT_INVALID");
    default:
      return new PageAdapterExecutionError("EXECUTION_FAILED");
  }
}
