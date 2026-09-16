import {
  canonicalizePageLocation,
  packMatchesLocation,
  type PackManifest,
} from "@mcpatch/sdk/runtime";

import type { RealmNavigation } from "./realm-navigation.js";

/**
 * The one navigation path a reviewed pack has, and the conditions on it.
 *
 * The isolated realm's own navigation primitives are removed, so a pack can
 * only navigate through here. This refuses unless an approved `ACTION` tool is
 * running, so a `read` tool has no side effect available to it beyond reading
 * the DOM, and it refuses a target the pack's manifest does not match, so an
 * approved action cannot be turned into a trip to an arbitrary page.
 */
export class PackNavigationGate {
  readonly #manifest: PackManifest;
  readonly #navigation: RealmNavigation;
  readonly #defer: (run: () => void) => void;
  #armed: AbortSignal | undefined;

  constructor(
    manifest: PackManifest,
    navigation: RealmNavigation,
    defer: (run: () => void) => void = queueMacrotask,
  ) {
    this.#manifest = manifest;
    this.#navigation = navigation;
    this.#defer = defer;
  }

  /**
   * Permit one navigation while an approved action runs. The call's signal is
   * kept so a navigation authorized just before a cancellation does not still
   * happen after it.
   */
  arm(signal: AbortSignal): void {
    this.#armed = signal;
  }

  /** Withdraw permission, whether or not the action navigated. */
  disarm(): void {
    this.#armed = undefined;
  }

  /**
   * Authorize one navigation for the approved action that is running, then
   * perform it after the current call has returned.
   *
   * Authorization happens now, while the gate knows which tool is running, so
   * a handler cannot smuggle the decision past the end of its call. The
   * navigation itself is deferred because it unloads the document, which would
   * otherwise destroy the page runtime before the tool result reaches the
   * client.
   */
  navigate(url: string): void {
    const signal = this.#armed;
    if (signal === undefined) {
      throw new TypeError("navigation requires an approved MCPatch action");
    }
    this.#armed = undefined;
    if (!this.#matches(url)) {
      throw new TypeError("navigation target is outside the pack's matches");
    }
    this.#defer(() => {
      // A call cancelled between authorization and the deferred navigation
      // must not still move the page.
      if (signal.aborted) return;
      this.#navigation.assign(url);
    });
  }

  /** True when the target canonicalises to a page this pack matches. */
  #matches(url: string): boolean {
    const target = canonicalizePageLocation(url);
    return target.ok && packMatchesLocation(this.#manifest, target.location);
  }
}

/** Runs after the current task, so the tool result is sent before unload. */
function queueMacrotask(run: () => void): void {
  globalThis.setTimeout(run, 0);
}
