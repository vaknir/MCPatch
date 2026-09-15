import { resolveContextCapabilities } from "@mcpatch/sdk/runtime";
import {
  PROTOCOL_VERSION,
  type CapabilitySnapshot,
  type ContextClosedReason,
} from "@mcpatch/protocol";

import { CompiledPackCallDispatcher } from "./compiled-pack-calls.js";
import type {
  ActiveContext,
  ContextActivationResult,
  MessageSender,
  PackRuntimeContext,
} from "./compiled-pack-model.js";
import {
  contextClosed,
  createRoutes,
  toProtocolCapability,
  validateNativeTools,
} from "./compiled-pack-projection.js";
import {
  validateCompiledPacks,
  validateRuntimeOptions,
  type CompiledPackSubject,
  type CompiledPackRuntimeOptions,
  type ValidatedCompiledPackRuntimeOptions,
  type ValidatedCompiledPack,
} from "./compiled-pack-validation.js";
import type { BridgeApplicationMessage } from "./native-session-model.js";

export type {
  ContextActivationResult,
  NativeRuntimeTool,
  PackRuntimeContext,
} from "./compiled-pack-model.js";

export class CompiledPackRuntime {
  readonly #send: MessageSender;
  readonly #options: ValidatedCompiledPackRuntimeOptions;
  readonly #calls: CompiledPackCallDispatcher;
  readonly #contexts = new Map<string, ActiveContext>();
  readonly #lastRevisions = new Map<string, number>();
  #packs: readonly ValidatedCompiledPack[];

  constructor(
    send: MessageSender,
    definitions: readonly CompiledPackSubject[],
    options: CompiledPackRuntimeOptions,
  ) {
    const checkedOptions = validateRuntimeOptions(options);
    const packs =
      checkedOptions === undefined
        ? undefined
        : validateCompiledPacks(definitions, checkedOptions);
    if (checkedOptions === undefined || packs === undefined) {
      throw new TypeError("compiled pack definitions were rejected");
    }
    this.#send = send;
    this.#options = checkedOptions;
    this.#calls = new CompiledPackCallDispatcher(send);
    this.#packs = packs;
  }

  activateContext(context: PackRuntimeContext): ContextActivationResult {
    const previous = this.#contexts.get(context.contextId);
    if (previous !== undefined && !this.#closeContext(previous, "navigation")) {
      return Object.freeze({ ok: false, code: "SNAPSHOT_REJECTED" });
    }
    const contextRevision =
      (this.#lastRevisions.get(context.contextId) ?? 0) + 1;
    this.#lastRevisions.set(context.contextId, contextRevision);
    const native = validateNativeTools(context.native, this.#options);
    if (native === undefined) {
      return Object.freeze({ ok: false, code: "RESOLUTION_REJECTED" });
    }
    const result = resolveContextCapabilities({
      contextId: context.contextId,
      contextRevision,
      url: context.url,
      native: native.map((value) => ({ name: value.tool.name, value })),
      packs: this.#packs.map((value) => ({ manifest: value.manifest, value })),
    });
    if (!result.ok) {
      return Object.freeze({ ok: false, code: "RESOLUTION_REJECTED" });
    }
    if (result.resolution.capabilities.length === 0) {
      return Object.freeze({ ok: true, published: false, contextRevision });
    }

    const routes = createRoutes(result.resolution.capabilities);
    const snapshot: CapabilitySnapshot = {
      protocolVersion: PROTOCOL_VERSION,
      type: "capability_snapshot",
      contextId: result.resolution.binding.contextId,
      contextRevision: result.resolution.binding.contextRevision,
      origin: result.resolution.binding.origin,
      capabilities: result.resolution.capabilities.map(toProtocolCapability),
    };
    if (!this.#send(snapshot)) {
      return Object.freeze({ ok: false, code: "SNAPSHOT_REJECTED" });
    }
    this.#contexts.set(
      context.contextId,
      Object.freeze({
        contextId: context.contextId,
        contextRevision,
        origin: result.resolution.binding.origin,
        routes,
      }),
    );
    return Object.freeze({ ok: true, published: true, contextRevision });
  }

  replaceDefinitions(definitions: readonly CompiledPackSubject[]): boolean {
    const packs = validateCompiledPacks(definitions, this.#options);
    this.closeAll("pack_disabled");
    this.#packs = packs ?? Object.freeze([]);
    return packs !== undefined;
  }

  disablePack(publisher: string, id: string): boolean {
    const packs = this.#packs.filter(
      (pack) =>
        pack.manifest.publisher !== publisher || pack.manifest.id !== id,
    );
    if (packs.length === this.#packs.length) return false;
    this.closeAll("pack_disabled");
    this.#packs = Object.freeze(packs);
    return true;
  }

  closeAll(reason: ContextClosedReason): void {
    const contexts = [...this.#contexts.values()].sort((left, right) =>
      left.contextId.localeCompare(right.contextId),
    );
    this.#contexts.clear();
    for (const context of contexts) {
      this.#calls.abortContext(context);
      this.#send(contextClosed(context, reason));
    }
  }

  disconnect(): void {
    const contexts = [...this.#contexts.values()];
    this.#contexts.clear();
    for (const context of contexts) this.#calls.abortContext(context);
  }

  handle(message: BridgeApplicationMessage): boolean {
    return this.#calls.handle(message, this.#contexts);
  }

  #closeContext(context: ActiveContext, reason: ContextClosedReason): boolean {
    this.#contexts.delete(context.contextId);
    this.#calls.abortContext(context);
    return this.#send(contextClosed(context, reason));
  }
}
