import { resolveContextCapabilities } from "@mcpatch/sdk/runtime";
import {
  PROTOCOL_VERSION,
  type CapabilitySnapshot,
  type ContextClosedReason,
} from "@mcpatch/protocol";

import { CompiledPackCallDispatcher } from "./compiled-pack-calls.js";
import {
  pageProjectionMatchesResolution,
  projectRuntimePacks,
} from "./compiled-page-routes.js";
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
  validateDeclarativeRuntimePacks,
  validateRuntimeOptions,
  type CompiledPackSubject,
  type CompiledPackRuntimeOptions,
  type ValidatedCompiledPackRuntimeOptions,
  type ValidatedCompiledPack,
  type ValidatedDeclarativePack,
  type ValidatedRuntimePack,
} from "./compiled-pack-validation.js";
import type { BridgeApplicationMessage } from "./native-session-model.js";

export type {
  ContextActivationResult,
  NativeRuntimeTool,
  PageRuntimeTool,
  PackRuntimeContext,
} from "./compiled-pack-model.js";

export class CompiledPackRuntime {
  readonly #send: MessageSender;
  readonly #options: ValidatedCompiledPackRuntimeOptions;
  readonly #calls: CompiledPackCallDispatcher;
  readonly #contexts = new Map<string, ActiveContext>();
  readonly #lastRevisions = new Map<string, number>();
  #compiledPacks: readonly ValidatedCompiledPack[];
  #declarativePacks: readonly ValidatedDeclarativePack[] = Object.freeze([]);
  #packs: readonly ValidatedRuntimePack[];

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
    this.#compiledPacks = packs;
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
    const projection = projectRuntimePacks(this.#packs, context.page);
    if (projection === undefined) {
      return Object.freeze({ ok: false, code: "RESOLUTION_REJECTED" });
    }
    const result = resolveContextCapabilities({
      contextId: context.contextId,
      contextRevision,
      url: context.url,
      native: native.map((value) => ({ name: value.tool.name, value })),
      packs: projection.candidates,
    });
    if (
      !result.ok ||
      !pageProjectionMatchesResolution(
        projection,
        result.resolution.capabilities,
        result.resolution.collisions,
      )
    ) {
      return Object.freeze({ ok: false, code: "RESOLUTION_REJECTED" });
    }
    if (result.resolution.capabilities.length === 0) {
      return Object.freeze({ ok: true, published: false, contextRevision });
    }

    const routes = createRoutes(
      result.resolution.capabilities,
      projection.pageHandlers,
    );
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
    this.#compiledPacks = packs ?? Object.freeze([]);
    return packs !== undefined && this.#replaceCombined();
  }

  async replaceDeclarativeDefinitions(
    bundles: readonly unknown[],
  ): Promise<boolean> {
    const packs = await validateDeclarativeRuntimePacks(bundles, this.#options);
    if (
      packs !== undefined &&
      sameDeclarativePacks(this.#declarativePacks, packs)
    ) {
      return true;
    }
    this.closeAll("pack_disabled");
    this.#declarativePacks = packs ?? Object.freeze([]);
    return packs !== undefined && this.#replaceCombined();
  }

  disablePack(publisher: string, id: string): boolean {
    const packs = this.#packs.filter(
      (pack) =>
        pack.manifest.publisher !== publisher || pack.manifest.id !== id,
    );
    if (packs.length === this.#packs.length) return false;
    this.closeAll("pack_disabled");
    this.#packs = Object.freeze(packs);
    this.#compiledPacks = Object.freeze(
      packs.filter(
        (pack): pack is ValidatedCompiledPack => pack.kind === "compiled",
      ),
    );
    this.#declarativePacks = Object.freeze(
      packs.filter(
        (pack): pack is ValidatedDeclarativePack => pack.kind === "declarative",
      ),
    );
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

  closeContext(contextId: string, reason: ContextClosedReason): boolean {
    const context = this.#contexts.get(contextId);
    return context === undefined ? false : this.#closeContext(context, reason);
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

  #replaceCombined(): boolean {
    const packs: ValidatedRuntimePack[] = [
      ...this.#compiledPacks,
      ...this.#declarativePacks,
    ];
    const identities = new Set<string>();
    if (packs.length > 64) {
      this.#packs = Object.freeze([]);
      return false;
    }
    for (const pack of packs) {
      const identity = `${pack.manifest.publisher}/${pack.manifest.id}`;
      if (identities.has(identity)) {
        this.#packs = Object.freeze([]);
        return false;
      }
      identities.add(identity);
    }
    this.#packs = Object.freeze(packs);
    return true;
  }
}

function sameDeclarativePacks(
  left: readonly ValidatedDeclarativePack[],
  right: readonly ValidatedDeclarativePack[],
): boolean {
  if (left.length !== right.length) return false;
  const fingerprints = (packs: readonly ValidatedDeclarativePack[]) =>
    packs
      .map(({ manifest }) =>
        JSON.stringify([
          manifest.publisher,
          manifest.id,
          manifest.version,
          manifest.digest,
        ]),
      )
      .sort();
  const leftFingerprints = fingerprints(left);
  const rightFingerprints = fingerprints(right);
  return leftFingerprints.every(
    (fingerprint, index) => fingerprint === rightFingerprints[index],
  );
}
