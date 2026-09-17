/**
 * Navigation lockdown for the isolated content-script realm.
 *
 * Navigation is a side effect with no permission class of its own. Any pack
 * handler, including one declared `risk: "read"`, could call
 * `location.assign`, set `location.href`, open a window or submit a form, and
 * the bridge would have dispatched it with no approval. On an authenticated
 * origin that is state-changing: it can trigger a server action through a GET,
 * sign the user out, or move the user to a page the pack then reads.
 *
 * Mutable ambient primitives are removed and the captured entry point is
 * returned to the reviewed document adapter for approved `ACTION` tools.
 * Chromium's Web IDL `Location` operations are non-configurable own
 * properties and cannot be replaced by JavaScript. Bundled page code is
 * therefore still reviewed trusted code; unsigned local packs remain
 * declarative data and cannot access those ambient operations.
 */

/** The isolated-world objects that can start a navigation. */
export interface NavigableRealm {
  open?: unknown;
  HTMLFormElement?: { readonly prototype: object };
  Location?: { readonly prototype: object };
  location?: object;
}

/** The captured navigation path exposed through the reviewed action gate. */
export interface RealmNavigation {
  /** Navigates the document, as `location.assign` would. */
  readonly assign: (url: string) => void;
}

const DENIED = "navigation is not available to MCPatch packs";

/**
 * Replaces every mutable ambient navigation primitive with a throwing stub
 * and returns the captured assign operation. Throws if the realm cannot
 * navigate at all. Unforgeable browser properties are detected and retained
 * instead of making every real Chromium content script fail at startup.
 */
export function removeNavigationPrimitives(
  realm: NavigableRealm,
): RealmNavigation {
  const prototype = realm.Location?.prototype;
  if (prototype === undefined) {
    throw new TypeError("realm has no Location to lock down");
  }
  const assign = capturedAssign(realm.location, prototype);
  denyLocationMethod(realm.location, prototype, "assign");
  denyLocationMethod(realm.location, prototype, "replace");
  denyHrefAssignment(realm.location, prototype);
  if ("open" in realm) denyMethod(realm as Record<string, unknown>, "open");
  const form = realm.HTMLFormElement?.prototype;
  if (form !== undefined) {
    denyMethod(form, "submit");
    denyMethod(form, "requestSubmit");
  }
  return Object.freeze({ assign });
}

/** The realm's own `assign`, bound to the live location before lockdown. */
function capturedAssign(
  location: object | undefined,
  prototype: object,
): (url: string) => void {
  const receiver = location ?? prototype;
  const original = propertyValue(receiver, prototype, "assign");
  if (typeof original !== "function") {
    throw new TypeError("realm location cannot navigate");
  }
  return (url: string) => {
    (original as (this: unknown, target: string) => void).call(receiver, url);
  };
}

function denyLocationMethod(
  location: object | undefined,
  prototype: object,
  name: string,
): void {
  const target = mutableLocationTarget(location, prototype, name);
  if (target !== undefined) denyMethod(target, name);
}

/**
 * `href` keeps its getter, because reading the current URL is an ordinary DOM
 * read that packs and the runtime both depend on. Only assignment navigates.
 */
function denyHrefAssignment(
  location: object | undefined,
  prototype: object,
): void {
  const target = mutableLocationTarget(location, prototype, "href");
  if (target === undefined) return;
  const descriptor = Object.getOwnPropertyDescriptor(target, "href");
  const get = descriptor?.get;
  Object.defineProperty(target, "href", {
    configurable: false,
    enumerable: descriptor?.enumerable ?? true,
    get:
      get ??
      (() => {
        throw new TypeError(DENIED);
      }),
    set() {
      throw new TypeError(DENIED);
    },
  });
}

function mutableLocationTarget(
  location: object | undefined,
  prototype: object,
  name: string,
): object | undefined {
  if (location !== undefined) {
    const own = Object.getOwnPropertyDescriptor(location, name);
    if (own !== undefined) {
      // Chromium exposes Location operations as non-configurable own
      // properties. Web IDL deliberately prevents replacing them; bundled
      // page code therefore remains part of the reviewed trust boundary.
      return own.configurable || ("writable" in own && own.writable)
        ? location
        : undefined;
    }
  }
  return name in prototype ? prototype : undefined;
}

function propertyValue(
  receiver: object,
  prototype: object,
  name: string,
): unknown {
  const own = Object.getOwnPropertyDescriptor(receiver, name);
  if (own !== undefined && "value" in own) return own.value;
  const inherited = Object.getOwnPropertyDescriptor(prototype, name);
  return inherited !== undefined && "value" in inherited
    ? inherited.value
    : undefined;
}

function denyMethod(target: object, name: string): void {
  if (!(name in target)) return;
  Object.defineProperty(target, name, {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze(function denied(): never {
      throw new TypeError(DENIED);
    }),
  });
}
