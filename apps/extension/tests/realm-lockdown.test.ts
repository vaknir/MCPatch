import { describe, expect, it, vi } from "vitest";

import {
  lockRealm,
  MAX_REQUEST_BODY_BYTES,
  MAX_RESPONSE_BYTES,
  type LockableRealm,
} from "../src/realm-lockdown.js";

const DECLARED = "https://symbol-search.tradingview.com";
const PAGE = "https://www.tradingview.com";

function realm(overrides: Partial<LockableRealm> = {}): {
  realm: LockableRealm;
  original: ReturnType<typeof vi.fn>;
} {
  const original = vi.fn(async (input: unknown) => {
    void input;
    return new Response("{}", {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const documentPrototype = {};
  Object.defineProperty(documentPrototype, "cookie", {
    configurable: true,
    get() {
      return "session=secret";
    },
    set() {},
  });
  const built: LockableRealm = {
    fetch: original as unknown as typeof fetch,
    XMLHttpRequest: function XMLHttpRequest() {},
    WebSocket: function WebSocket() {},
    EventSource: function EventSource() {},
    navigator: { sendBeacon: () => true },
    Document: { prototype: documentPrototype },
    ...overrides,
  };
  return { realm: built, original };
}

describe("realm lockdown", () => {
  it("passes a declared-origin https request through and returns the response", async () => {
    const { realm: r, original } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED, PAGE] });

    const response = await r.fetch(`${DECLARED}/search?query=AAPL`);
    expect(response.status).toBe(200);
    expect(original).toHaveBeenCalledOnce();
    const forwarded = original.mock.calls[0]?.[0] as Request;
    expect(new URL(forwarded.url).origin).toBe(DECLARED);
  });

  it("rejects an undeclared origin, http, and same-origin to an undeclared page", async () => {
    const { realm: r, original } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED] });

    await expect(r.fetch("https://attacker.example/collect")).rejects.toThrow(
      /origin is not declared/,
    );
    await expect(
      r.fetch(`http://symbol-search.tradingview.com/x`),
    ).rejects.toThrow(/https/);
    // The page origin is not in the allowlist, so a same-origin request fails.
    await expect(r.fetch(`${PAGE}/api/self`)).rejects.toThrow(
      /origin is not declared/,
    );
    expect(original).not.toHaveBeenCalled();
  });

  it("preserves caller credentials to a declared origin for approved actions", async () => {
    const { realm: r, original } = realm();
    lockRealm(r, { allowedOrigins: [PAGE] });

    await r.fetch(`${PAGE}/api/v1/symbols_list/custom/1/append/`, {
      method: "POST",
      credentials: "include",
      body: JSON.stringify(["NASDAQ:AAPL"]),
    });
    const forwarded = original.mock.calls[0]?.[0] as Request;
    expect(forwarded.credentials).toBe("include");
    expect(forwarded.method).toBe("POST");
  });

  it("strips Authorization and Cookie headers set by pack code", async () => {
    const { realm: r, original } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED] });

    await r.fetch(`${DECLARED}/search`, {
      headers: {
        Authorization: "Bearer stolen",
        Cookie: "session=secret",
        Accept: "application/json",
      },
    });
    const forwarded = original.mock.calls[0]?.[0] as Request;
    expect(forwarded.headers.get("authorization")).toBeNull();
    expect(forwarded.headers.get("cookie")).toBeNull();
    expect(forwarded.headers.get("accept")).toBe("application/json");
  });

  it("rejects an over-large request body and an over-large declared response", async () => {
    const { realm: r } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED] });
    await expect(
      r.fetch(`${DECLARED}/x`, {
        method: "POST",
        body: "x".repeat(MAX_REQUEST_BODY_BYTES + 1),
      }),
    ).rejects.toThrow(/request body is too large/);

    const big = realm();
    big.original.mockResolvedValueOnce(
      new Response("{}", {
        headers: { "content-length": String(MAX_RESPONSE_BYTES + 1) },
      }),
    );
    lockRealm(big.realm, { allowedOrigins: [DECLARED] });
    await expect(big.realm.fetch(`${DECLARED}/x`)).rejects.toThrow(
      /response is too large/,
    );
  });

  it("removes every other network primitive", () => {
    const { realm: r } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED] });

    expect(() => new (r.XMLHttpRequest as new () => unknown)()).toThrow(
      /XMLHttpRequest/,
    );
    expect(() => new (r.WebSocket as new () => unknown)()).toThrow(/WebSocket/);
    expect(() => new (r.EventSource as new () => unknown)()).toThrow(
      /EventSource/,
    );
    expect(() => (r.navigator?.sendBeacon as () => unknown)()).toThrow(
      /sendBeacon/,
    );
  });

  it("makes document.cookie throw on read and write in the isolated realm", () => {
    const { realm: r } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED] });
    const prototype = r.Document?.prototype as { cookie: string };
    expect(() => prototype.cookie).toThrow(/cookies are not available/);
    expect(() => {
      prototype.cookie = "x=y";
    }).toThrow(/cookies are not available/);
  });

  it("installs non-configurable replacements that survive delete and redefine", () => {
    const { realm: r } = realm();
    lockRealm(r, { allowedOrigins: [DECLARED] });

    const record = r as unknown as Record<string, unknown>;
    expect(() => {
      "use strict";
      delete record["fetch"];
    }).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(r, "fetch", { value: globalThis.fetch }),
    ).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(r, "XMLHttpRequest", {
        value: function XMLHttpRequest() {},
      }),
    ).toThrow(TypeError);
    // The wrapped fetch is still the enforcing one.
    expect(Object.getOwnPropertyDescriptor(r, "fetch")?.writable).toBe(false);
  });

  it("fails closed when a required global is missing", () => {
    expect(() =>
      lockRealm(
        { fetch: undefined as unknown as typeof fetch },
        {
          allowedOrigins: [DECLARED],
        },
      ),
    ).toThrow(/no fetch/);
  });

  it("rejects a non-canonical declared origin rather than locking down loosely", () => {
    const { realm: r } = realm();
    expect(() =>
      lockRealm(r, { allowedOrigins: ["https://x.example/path"] }),
    ).toThrow(/canonical https origin/);
    expect(() =>
      lockRealm(r, { allowedOrigins: ["http://x.example"] }),
    ).toThrow(/canonical https origin/);
  });

  it("locks a realm with no cookie prototype or beacon without failing", () => {
    const { realm: r } = realm({ navigator: {} });
    delete r.Document;
    expect(() => lockRealm(r, { allowedOrigins: [DECLARED] })).not.toThrow();
  });
});
