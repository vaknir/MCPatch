import { type PackManifest } from "@mcpatch/sdk/runtime";

import type { RealmNavigation } from "./realm-navigation.js";

/** Schedules one context-revoking navigation after the tool result can be sent. */
export class DeclarativeNavigationCoordinator {
  readonly #manifest: PackManifest;
  readonly #navigation: RealmNavigation;
  readonly #defer: (run: () => void) => void;
  #revoke: (() => void) | undefined;

  constructor(
    manifest: PackManifest,
    navigation: RealmNavigation,
    defer: (run: () => void) => void = (run) => globalThis.setTimeout(run, 0),
  ) {
    this.#manifest = manifest;
    this.#navigation = navigation;
    this.#defer = defer;
  }

  bindContextRevocation(revoke: () => void): void {
    if (this.#revoke !== undefined) {
      throw new TypeError("navigation context revocation is already bound");
    }
    this.#revoke = revoke;
  }

  schedule(url: string, signal: AbortSignal): void {
    const revoke = this.#revoke;
    if (revoke === undefined) {
      throw new TypeError("navigation context revocation is unavailable");
    }
    if (!matchesNavigationTarget(this.#manifest, url)) {
      throw new TypeError("navigation target is outside the pack's matches");
    }
    this.#defer(() => {
      if (signal.aborted) return;
      revoke();
      this.#navigation.assign(url);
    });
  }
}

function matchesNavigationTarget(
  manifest: PackManifest,
  value: string,
): boolean {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return false;
  }
  if (
    target.protocol !== "https:" ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== "" ||
    target.href !== value
  ) {
    return false;
  }
  let path: string;
  try {
    path = decodeURIComponent(target.pathname);
  } catch {
    return false;
  }
  return manifest.matches.some(
    (match) =>
      match.origin === target.origin &&
      match.paths.some((rule) =>
        rule.kind === "exact" ? path === rule.path : path.startsWith(rule.path),
      ),
  );
}
