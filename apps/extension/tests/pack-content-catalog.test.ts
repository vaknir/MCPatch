import { describe, expect, it, vi } from "vitest";

import type { PageAuthority } from "../src/page-context-model.js";
import {
  catalogRegistrationId,
  PackContentCatalog,
  type PackContentSite,
} from "../src/pack-content-catalog.js";
import { FakePermissions, FakeScripting } from "./support/enablement.js";

const ORIGIN = "https://app.example.com";
const OTHER_ORIGIN = "https://other.example.com";

describe("dynamic pack content catalog", () => {
  it("combines reviewed and declarative paths into one exact-origin registration", async () => {
    const state = setup();

    await state.reviewed.replace([
      site("reviewed:one", ORIGIN, [`${ORIGIN}/reviewed/*`]),
    ]);
    await state.declarative.replace([
      site("declarative:one", ORIGIN, [`${ORIGIN}/local/*`]),
    ]);

    expect([...state.scripting.registrations.values()]).toEqual([
      registration(ORIGIN, [`${ORIGIN}/local/*`, `${ORIGIN}/reviewed/*`]),
    ]);
  });

  it("keeps a shared registration and permission while another source needs it", async () => {
    const state = setup();
    const permission = `${ORIGIN}/*`;
    state.permissions.granted.add(permission);
    await state.reviewed.replace([site("reviewed:one", ORIGIN)]);
    await state.declarative.replace([site("declarative:one", ORIGIN)]);

    await state.reviewed.replace([]);
    await state.reviewed.removeUnusedPermissions([permission]);

    expect(state.permissions.granted).toContain(permission);
    expect(state.scripting.registrations.size).toBe(1);
    await state.declarative.replace([]);
    await state.declarative.removeUnusedPermissions([permission]);
    expect(state.permissions.granted).not.toContain(permission);
  });

  it("does not remove permissions until every source has reconciled", async () => {
    const state = setup();
    const permission = `${ORIGIN}/*`;
    state.permissions.granted.add(permission);
    await state.reviewed.replace([]);

    await state.reviewed.removeUnusedPermissions([permission]);

    expect(state.permissions.granted).toContain(permission);
  });

  it("is idempotent and serializes concurrent source changes", async () => {
    const state = setup();
    const reviewed = site("reviewed:one", ORIGIN);
    await state.reviewed.replace([reviewed]);
    state.scripting.log.length = 0;
    await state.reviewed.replace([reviewed]);
    expect(state.scripting.log).toEqual([]);

    await Promise.all([
      state.reviewed.replace([reviewed, site("reviewed:two", OTHER_ORIGIN)]),
      state.declarative.replace([site("declarative:one", ORIGIN)]),
      state.reviewed.replace([reviewed]),
    ]);
    expect([...state.scripting.registrations.keys()]).toEqual([
      catalogRegistrationId(ORIGIN),
    ]);
  });

  it("removes legacy and drifted registrations before restoring readiness", async () => {
    const state = setup();
    state.scripting.registrations.set("mcpatch-v1-legacy", {
      ...registration(ORIGIN),
      id: "mcpatch-v1-legacy",
    });
    state.scripting.registrations.set(catalogRegistrationId(ORIGIN), {
      ...registration(ORIGIN),
      js: ["attacker.js"],
    });

    await state.reviewed.replace([site("reviewed:one", ORIGIN)]);

    expect(state.scripting.registrations.has("mcpatch-v1-legacy")).toBe(false);
    expect(
      state.scripting.registrations.get(catalogRegistrationId(ORIGIN)),
    ).toEqual(registration(ORIGIN));
    expect(state.revoke).toHaveBeenCalledWith(ORIGIN);
  });

  it("revokes before script mutation when aggregate identity changes", async () => {
    const state = setup();
    await state.reviewed.replace([site("reviewed:v1", ORIGIN)]);
    state.scripting.log.length = 0;
    state.revoke.mockClear();
    state.catalog.setRevokeOrigin((origin) => {
      state.scripting.log.push(`revoke:${origin}`);
      state.revoke(origin);
    });

    await state.reviewed.replace([
      site("reviewed:v2", ORIGIN, [`${ORIGIN}/v2/*`]),
    ]);

    expect(state.scripting.log[0]).toBe(`revoke:${ORIGIN}`);
    expect(state.scripting.log).toContain("scripts.unregister");
    expect(state.scripting.log).toContain("scripts.register");
  });

  it("fails closed when Chrome rejects registration", async () => {
    const state = setup();
    const authority = authorityFor("tool.read");
    state.catalog.setAuthorities([authority]);
    state.scripting.throwRegister = true;

    await expect(
      state.reviewed.replace([site("reviewed:one", ORIGIN)]),
    ).rejects.toThrow("register scripts failed");

    expect(state.catalog.authority.authorize(identity(ORIGIN))).toBeUndefined();
    expect(state.revoke).toHaveBeenCalledWith(ORIGIN);
  });

  it("gates and combines tool authority behind a ready exact origin", async () => {
    const state = setup();
    state.catalog.setAuthorities([
      authorityFor("reviewed.read"),
      authorityFor("declarative.read"),
    ]);
    expect(state.catalog.authority.authorize(identity(ORIGIN))).toBeUndefined();

    await state.reviewed.replace([site("reviewed:one", ORIGIN)]);
    await state.declarative.replace([]);

    expect(state.catalog.authority.authorize(identity(ORIGIN))).toEqual({
      packTools: new Set(["reviewed.read", "declarative.read"]),
    });
    expect(
      state.catalog.authority.authorize(identity(OTHER_ORIGIN)),
    ).toBeUndefined();
  });

  it.each([
    site("wildcard", "https://*.example.com"),
    site("http", "http://example.com"),
    { ...site("bad-match", ORIGIN), matches: ["https://attacker.example/*"] },
    { ...site("bad-grant", ORIGIN), permissionPatterns: ["https://*/*"] },
    { ...site("duplicate", ORIGIN), matches: [`${ORIGIN}/*`, `${ORIGIN}/*`] },
  ])("rejects hostile or ambiguous source input %#", async (candidate) => {
    const state = setup();
    await expect(state.reviewed.replace([candidate])).rejects.toThrow(
      TypeError,
    );
    expect(state.scripting.registrations.size).toBe(0);
  });

  it("rejects duplicate source identities on one origin", async () => {
    const state = setup();
    const duplicate = site("reviewed:one", ORIGIN);
    await expect(
      state.reviewed.replace([duplicate, duplicate]),
    ).rejects.toThrow("duplicate");
  });

  it("bounds aggregate origins and merged match rules", async () => {
    const origins = setup();
    await expect(
      origins.reviewed.replace(
        Array.from({ length: 65 }, (_, index) => {
          const origin = `https://site-${index}.example.com`;
          return site(`reviewed:${index}`, origin);
        }),
      ),
    ).rejects.toThrow("origin limit");
    expect(origins.scripting.registrations.size).toBe(0);

    const matches = setup();
    await matches.reviewed.replace([
      site(
        "reviewed:many",
        ORIGIN,
        Array.from({ length: 64 }, (_, index) => `${ORIGIN}/r-${index}/*`),
      ),
    ]);
    await expect(
      matches.declarative.replace([
        site("declarative:extra", ORIGIN, [`${ORIGIN}/extra/*`]),
      ]),
    ).rejects.toThrow("match limit");
    expect(
      matches.scripting.registrations.get(catalogRegistrationId(ORIGIN)),
    ).toEqual(
      registration(
        ORIGIN,
        Array.from(
          { length: 64 },
          (_, index) => `${ORIGIN}/r-${index}/*`,
        ).sort(),
      ),
    );
  });
});

function setup() {
  const scripting = new FakeScripting();
  const permissions = new FakePermissions();
  const catalog = new PackContentCatalog(scripting, permissions);
  const revoke = vi.fn<(origin: string) => void>();
  catalog.setRevokeOrigin(revoke);
  return {
    catalog,
    declarative: catalog.createSource("declarative"),
    permissions,
    reviewed: catalog.createSource("reviewed"),
    revoke,
    scripting,
  };
}

function site(
  fingerprint: string,
  origin: string,
  matches: readonly string[] = [`${origin}/*`],
): PackContentSite {
  return {
    fingerprint,
    matches,
    origin,
    permissionPatterns: [`${origin}/*`],
  };
}

function registration(origin: string, matches = [`${origin}/*`]) {
  return {
    id: catalogRegistrationId(origin),
    matches,
    js: ["content-script.js"],
    allFrames: false as const,
    persistAcrossSessions: true as const,
    runAt: "document_start" as const,
    world: "ISOLATED" as const,
  };
}

function authorityFor(tool: string): PageAuthority {
  return {
    authorize: () => ({ packTools: new Set([tool]) }),
  };
}

function identity(origin: string) {
  return {
    tabId: 1,
    documentId: "document-1",
    origin,
    url: `${origin}/app`,
  };
}
