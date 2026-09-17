import type { DeclarativePackBundleContent } from "@mcpatch/sdk/runtime";

import type { CompiledPackRuntime } from "./compiled-pack-runtime.js";

export interface DeclarativeDefinitionSource {
  replace(bundles: readonly DeclarativePackBundleContent[]): Promise<boolean>;
}

interface SourceState {
  bundles: readonly DeclarativePackBundleContent[];
}

/** Transactionally combines declarative definitions from independent trust tiers. */
export class DeclarativeDefinitionCatalog {
  readonly #sources = new Map<string, SourceState>();
  #chain = Promise.resolve();
  #runtime: CompiledPackRuntime | undefined;

  createSource(name: string): DeclarativeDefinitionSource {
    if (!/^[a-z][a-z0-9-]{0,31}$/u.test(name) || this.#sources.has(name)) {
      throw new TypeError("declarative definition source was rejected");
    }
    const state: SourceState = { bundles: Object.freeze([]) };
    this.#sources.set(name, state);
    return Object.freeze({
      replace: (bundles: readonly DeclarativePackBundleContent[]) =>
        this.#enqueue(() => this.#replace(state, bundles)),
    });
  }

  setRuntime(runtime: CompiledPackRuntime): void {
    if (this.#runtime !== undefined) {
      throw new TypeError("declarative definition runtime already set");
    }
    this.#runtime = runtime;
  }

  async #replace(
    state: SourceState,
    bundles: readonly DeclarativePackBundleContent[],
  ): Promise<boolean> {
    if (!Array.isArray(bundles) || bundles.length > 64) return false;
    const previous = state.bundles;
    const candidate = Object.freeze([...bundles]);
    const runtime = this.#runtime;
    if (runtime === undefined) return false;
    state.bundles = candidate;
    const combined = this.#combined();
    if (combined === undefined) {
      state.bundles = previous;
      return false;
    }
    try {
      if (await runtime.replaceDeclarativeDefinitions(combined)) return true;
    } catch {
      // A runtime failure cannot commit candidate authority.
    }
    state.bundles = previous;
    const rollback = this.#combined();
    if (rollback !== undefined) {
      try {
        await runtime.replaceDeclarativeDefinitions(rollback);
      } catch {
        // The caller receives false; bridge/session teardown remains the outer failsafe.
      }
    }
    return false;
  }

  #combined(): readonly DeclarativePackBundleContent[] | undefined {
    const combined = [...this.#sources.values()].flatMap((source) => [
      ...source.bundles,
    ]);
    if (combined.length > 64) return undefined;
    const identities = new Set<string>();
    for (const bundle of combined) {
      const identity = JSON.stringify([
        bundle.manifest.publisher,
        bundle.manifest.id,
      ]);
      if (identities.has(identity)) return undefined;
      identities.add(identity);
    }
    return Object.freeze(combined);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#chain.then(operation, operation);
    this.#chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
