import type { JsonObject, JsonValue } from "@mcpatch/protocol";

import {
  encodeBoundedJsonFrame,
  parseBoundedJsonFrame,
} from "./page-channel-json.js";
import type { PageCapability } from "./page-channel.js";
import {
  PageAdapterExecutionError,
  type PageAdapter,
} from "./page-content-model.js";
import type {
  DraftModelContext,
  DraftRegisteredTool,
  DraftWebMcpDocument,
} from "./native-webmcp-model.js";
import {
  validateNativeTool,
  type ValidatedNativeTool,
} from "./native-webmcp-validation.js";

const MAX_NATIVE_TOOLS = 128;

export function createNativeWebMcpAdapter(
  document: unknown,
  expectedOrigin: string,
): PageAdapter | undefined {
  const modelContext = detectModelContext(document);
  return modelContext === undefined
    ? undefined
    : new NativeWebMcpAdapter(modelContext, expectedOrigin);
}

export class NativeWebMcpAdapter implements PageAdapter {
  readonly #modelContext: DraftModelContext;
  readonly #origin: string;
  #discoveryGeneration = 0;
  #handles = new Map<string, DraftRegisteredTool>();

  constructor(modelContext: DraftModelContext, expectedOrigin: string) {
    this.#modelContext = modelContext;
    this.#origin = canonicalOrigin(expectedOrigin);
  }

  async capabilities(signal: AbortSignal): Promise<readonly PageCapability[]> {
    if (signal.aborted) throw new PageAdapterExecutionError("CANCELLED");
    const generation = ++this.#discoveryGeneration;
    let values: unknown;
    try {
      values = await this.#modelContext.getTools();
    } catch (error) {
      throw mapExecutionError(signal, error);
    }
    if (signal.aborted || generation !== this.#discoveryGeneration) {
      throw new PageAdapterExecutionError("CANCELLED");
    }
    if (!Array.isArray(values) || values.length > MAX_NATIVE_TOOLS) {
      throw new PageAdapterExecutionError("EXECUTION_FAILED");
    }

    const candidates = values
      .map((value) => validateNativeTool(value, this.#origin))
      .filter((value): value is ValidatedNativeTool => value !== undefined);
    const counts = new Map<string, number>();
    for (const candidate of candidates) {
      counts.set(
        candidate.capability.name,
        (counts.get(candidate.capability.name) ?? 0) + 1,
      );
    }
    const accepted = candidates.filter(
      (candidate) => counts.get(candidate.capability.name) === 1,
    );
    this.#handles = new Map(
      accepted.map((candidate) => [
        candidate.capability.name,
        candidate.handle,
      ]),
    );
    return Object.freeze(accepted.map((candidate) => candidate.capability));
  }

  async execute(
    tool: string,
    args: JsonObject,
    signal: AbortSignal,
  ): Promise<JsonValue> {
    const handle = this.#handles.get(tool);
    if (handle === undefined) {
      throw new PageAdapterExecutionError("TOOL_UNAVAILABLE");
    }
    if (signal.aborted) throw new PageAdapterExecutionError("CANCELLED");
    let result: unknown;
    try {
      const input = parseBoundedJsonFrame(encodeBoundedJsonFrame(args));
      result = await this.#modelContext.executeTool(handle, input, { signal });
    } catch (error) {
      throw mapExecutionError(signal, error);
    }
    if (signal.aborted) throw new PageAdapterExecutionError("CANCELLED");
    try {
      return parseBoundedJsonFrame(encodeBoundedJsonFrame(result)) as JsonValue;
    } catch {
      throw new PageAdapterExecutionError("RESULT_INVALID");
    }
  }

  subscribe(listener: () => void): () => void {
    const changed = () => {
      this.#discoveryGeneration += 1;
      this.#handles.clear();
      listener();
    };
    this.#modelContext.addEventListener("toolchange", changed);
    return () => this.#modelContext.removeEventListener("toolchange", changed);
  }
}

function detectModelContext(document: unknown): DraftModelContext | undefined {
  if (typeof document !== "object" || document === null) return undefined;
  let candidate: unknown;
  try {
    candidate = (document as DraftWebMcpDocument).modelContext;
  } catch {
    return undefined;
  }
  if (typeof candidate !== "object" || candidate === null) return undefined;
  try {
    const context = candidate as Partial<DraftModelContext>;
    if (
      typeof context.getTools !== "function" ||
      typeof context.executeTool !== "function" ||
      typeof context.addEventListener !== "function" ||
      typeof context.removeEventListener !== "function"
    ) {
      return undefined;
    }
    return {
      getTools: context.getTools.bind(candidate),
      executeTool: context.executeTool.bind(candidate),
      addEventListener: context.addEventListener.bind(candidate),
      removeEventListener: context.removeEventListener.bind(candidate),
    };
  } catch {
    return undefined;
  }
}

function canonicalOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.origin !== value
    ) {
      throw new Error("invalid origin");
    }
    return value;
  } catch {
    throw new TypeError("native WebMCP origin must be canonical HTTPS");
  }
}

function mapExecutionError(
  signal: AbortSignal,
  error: unknown,
): PageAdapterExecutionError {
  let name: unknown;
  if (typeof error === "object" && error !== null) {
    try {
      name = (error as { readonly name?: unknown }).name;
    } catch {
      name = undefined;
    }
  }
  return new PageAdapterExecutionError(
    signal.aborted || name === "AbortError" ? "CANCELLED" : "EXECUTION_FAILED",
  );
}
