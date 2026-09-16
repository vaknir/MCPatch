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
 * Removing the ambient primitives leaves exactly one way to navigate: the
 * captured entry point returned here, which the reviewed document adapter
 * hands only to an approved `ACTION` tool.
 */

/** The isolated-world objects that can start a navigation. */
export interface NavigableRealm {
  open?: unknown;
  HTMLFormElement?: { readonly prototype: object };
  Location?: { readonly prototype: object };
}

/** The one navigation path left in a locked realm. */
export interface RealmNavigation {
  /** Navigates the document, as `location.assign` would. */
  readonly assign: (url: string) => void;
}

const DENIED = "navigation is not available to MCPatch packs";

/**
 * Replaces every ambient navigation primitive with a throwing stub and
 * returns the captured one. Throws if the realm cannot navigate at all, so
 * the caller fails closed rather than running packs in a half-locked realm.
 */
export function removeNavigationPrimitives(
  realm: NavigableRealm,
): RealmNavigation {
  const prototype = realm.Location?.prototype;
  if (prototype === undefined) {
    throw new TypeError("realm has no Location to lock down");
  }
  const assign = capturedAssign(prototype);
  denyMethod(prototype, "assign");
  denyMethod(prototype, "replace");
  denyHrefAssignment(prototype);
  if ("open" in realm) denyMethod(realm as Record<string, unknown>, "open");
  const form = realm.HTMLFormElement?.prototype;
  if (form !== undefined) {
    denyMethod(form, "submit");
    denyMethod(form, "requestSubmit");
  }
  return Object.freeze({ assign });
}

/** The realm's own `assign`, bound to the live location before it is removed. */
function capturedAssign(prototype: object): (url: string) => void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "assign");
  const original = descriptor?.value as unknown;
  if (typeof original !== "function") {
    throw new TypeError("realm location cannot navigate");
  }
  return (url: string) => {
    (original as (this: unknown, target: string) => void).call(
      globalThis.location,
      url,
    );
  };
}

/**
 * `href` keeps its getter, because reading the current URL is an ordinary DOM
 * read that packs and the runtime both depend on. Only assignment navigates.
 */
function denyHrefAssignment(prototype: object): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "href");
  const get = descriptor?.get;
  Object.defineProperty(prototype, "href", {
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
