/**
 * Realm lockdown for the isolated content-script world that reviewed compiled
 * packs run in.
 *
 * A pack handler runs with the full authority of an isolated-world content
 * script: its own `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
 * `navigator.sendBeacon`, and a `Document.prototype` whose `cookie` accessor
 * reads the page's non-HttpOnly cookies. `networkPolicy.extensionRequests` was
 * honoured only by review of pack source plus Chrome host permissions; nothing
 * MCPatch-owned bounded those primitives at runtime.
 *
 * `lockRealm` installs, before any pack code runs, a fixed set of replacements
 * that turn the declared-origin network bound and the no-cookie bound into
 * mechanism for every compiled pack:
 *
 * - `fetch` is replaced with a wrapper that requires `https:`, allows only the
 *   pack's declared request origins (exact, normalised; same-origin to the page
 *   is allowed only when the page origin is itself declared), strips any
 *   `Authorization` or `Cookie` header set by pack code, and rejects an
 *   over-large request body. Credentials the caller requests are preserved so
 *   the reviewed, approved session actions (ADR 0012) still work; because an
 *   undeclared origin is refused outright, no credentialed request can reach
 *   one.
 * - `XMLHttpRequest`, `WebSocket`, `EventSource`, and `navigator.sendBeacon`
 *   are removed, so the only network channel left is the wrapped `fetch`.
 * - `Document.prototype.cookie` becomes a throwing accessor, so pack code
 *   cannot read or write cookies.
 *
 * Every replacement is frozen and non-configurable, so pack code cannot
 * `delete`, redefine, or walk a prototype back to the original. The isolated
 * world has its own globals and prototypes, so none of this is observable from
 * the page.
 *
 * The function is all-or-nothing: if any step throws, it rethrows so the caller
 * fails closed and publishes no capability snapshot for the document.
 */

/** Exact, normalised `https://host[:port]` origins a pack may request. */
export interface RealmNetworkPolicy {
  readonly allowedOrigins: readonly string[];
}

/** The isolated-world globals `lockRealm` replaces. Real callers pass the
 * content script's `globalThis`; tests pass a stand-in with the same shape. */
export interface LockableRealm {
  fetch: typeof fetch;
  XMLHttpRequest?: unknown;
  WebSocket?: unknown;
  EventSource?: unknown;
  navigator?: { sendBeacon?: unknown };
  Document?: { readonly prototype: object };
}

/** Largest request body a pack may send. Reviewed packs send small JSON
 * bodies; this bounds a compromised handler without affecting them. */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

/** Reject a response whose declared length exceeds this. Bodies without a
 * `Content-Length` are additionally bounded by each pack's own reads. */
export const MAX_RESPONSE_BYTES = 512 * 1024;

const STRIPPED_REQUEST_HEADERS = Object.freeze(["authorization", "cookie"]);

/**
 * Install the lockdown on `realm`. Throws if any step fails; the caller must
 * treat a throw as fail-closed and publish nothing for the document.
 */
export function lockRealm(
  realm: LockableRealm,
  policy: RealmNetworkPolicy,
): void {
  const allowed = normalizeOrigins(policy.allowedOrigins);
  const originalFetch = realm.fetch;
  if (typeof originalFetch !== "function") {
    throw new TypeError("realm has no fetch to lock down");
  }

  installFetch(realm, originalFetch, allowed);
  removeNetworkPrimitive(realm, "XMLHttpRequest");
  removeNetworkPrimitive(realm, "WebSocket");
  removeNetworkPrimitive(realm, "EventSource");
  removeSendBeacon(realm);
  sealCookieAccessor(realm);
}

function installFetch(
  realm: LockableRealm,
  originalFetch: typeof fetch,
  allowed: ReadonlySet<string>,
): void {
  const wrapped = async function fetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url = resolveUrl(input);
    if (url.protocol !== "https:") {
      throw new TypeError("MCPatch pack requests must use https");
    }
    if (!allowed.has(url.origin)) {
      throw new TypeError("MCPatch pack request origin is not declared");
    }
    const request = new Request(input as RequestInfo, init);
    if (bodyLength(init) > MAX_REQUEST_BODY_BYTES) {
      throw new TypeError("MCPatch pack request body is too large");
    }
    for (const header of STRIPPED_REQUEST_HEADERS) {
      request.headers.delete(header);
    }
    const response = await originalFetch.call(realm, request);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
      throw new TypeError("MCPatch pack response is too large");
    }
    return response;
  };
  define(realm, "fetch", Object.freeze(wrapped));
}

function removeNetworkPrimitive(realm: LockableRealm, name: string): void {
  const throwing = frozenThrower(`${name} is not available to MCPatch packs`);
  define(realm as unknown as Record<string, unknown>, name, throwing);
}

function removeSendBeacon(realm: LockableRealm): void {
  const navigator = realm.navigator;
  if (navigator === undefined || !("sendBeacon" in navigator)) return;
  const throwing = frozenThrower(
    "sendBeacon is not available to MCPatch packs",
  );
  define(
    navigator as unknown as Record<string, unknown>,
    "sendBeacon",
    throwing,
  );
}

function sealCookieAccessor(realm: LockableRealm): void {
  const prototype = realm.Document?.prototype;
  if (prototype === undefined) return;
  Object.defineProperty(prototype, "cookie", {
    configurable: false,
    enumerable: false,
    get() {
      throw new TypeError("cookies are not available to MCPatch packs");
    },
    set() {
      throw new TypeError("cookies are not available to MCPatch packs");
    },
  });
}

function normalizeOrigins(origins: readonly string[]): ReadonlySet<string> {
  const normalized = new Set<string>();
  for (const origin of origins) {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new TypeError("declared request origin is not a valid URL");
    }
    if (url.protocol !== "https:" || url.origin !== origin) {
      throw new TypeError(
        "declared request origin is not a canonical https origin",
      );
    }
    normalized.add(url.origin);
  }
  return normalized;
}

function resolveUrl(input: RequestInfo | URL): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  if (typeof Request !== "undefined" && input instanceof Request) {
    return new URL(input.url);
  }
  throw new TypeError("MCPatch pack request target is not a URL");
}

function bodyLength(init: RequestInit | undefined): number {
  const body = init?.body;
  if (body === undefined || body === null) return 0;
  if (typeof body === "string") return body.length;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  // Streams and form bodies cannot be measured synchronously; treat as at the
  // cap so an unbounded body is refused rather than waved through.
  return MAX_REQUEST_BODY_BYTES + 1;
}

function frozenThrower(message: string): () => never {
  return Object.freeze(function denied(): never {
    throw new TypeError(message);
  });
}

function define(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    configurable: false,
    enumerable: false,
    writable: false,
    value,
  });
}
