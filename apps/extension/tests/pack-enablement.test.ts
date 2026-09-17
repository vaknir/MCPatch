import { describe, expect, it, vi } from "vitest";

import {
  ENABLEMENT_STORAGE_KEY,
  type ChromeRegisteredContentScript,
  type EnabledPackRecord,
  type ReviewedPackSite,
} from "../src/enablement-model.js";
import { parseEnablementState } from "../src/enablement-storage.js";
import { PackEnablementController } from "../src/pack-enablement.js";
import {
  createReviewedPackCatalog,
  recordForSite,
} from "../src/reviewed-pack-catalog.js";
import { FakeEnablementApi } from "./support/enablement.js";
import {
  NETWORK_ORIGIN,
  networkSitePack,
  runtimeOptions,
  SITE_ORIGIN,
  SITE_TOOL,
  testCatalog,
} from "./support/site-pack.js";

const SITE_URL = `${SITE_ORIGIN}/app/search?q=TLV`;

describe("pack enablement controller", () => {
  it("requests and persists only the clicked pack's exact declared origin", async () => {
    const state = await setup();

    state.api.action.onClicked.emit({ id: 7, url: SITE_URL });
    await settle(state.controller);

    expect(state.api.permissions.requests).toEqual([
      { origins: [`${SITE_ORIGIN}/*`] },
    ]);
    expect(storedRecords(state.api)).toEqual([recordForSite(state.site)]);
    expect([...state.api.scripting.registrations.values()]).toEqual([
      expectedRegistration(state.site),
    ]);
    expect(state.controller.authority.authorize(identity())).toEqual({
      packTools: new Set([SITE_TOOL]),
    });
    expect(state.api.storage.accessLevels).not.toHaveLength(0);
    expect(
      state.api.storage.accessLevels.every(
        (level) => level === "TRUSTED_CONTEXTS",
      ),
    ).toBe(true);
  });

  it("leaves no state or script when the user denies permission", async () => {
    const state = await setup();
    state.api.permissions.nextRequest = false;

    state.api.action.onClicked.emit({ id: 7, url: SITE_URL });
    await settle(state.controller);

    expect(state.api.permissions.requests).toHaveLength(1);
    expect(storedRecords(state.api)).toEqual([]);
    expect(state.api.scripting.registrations.size).toBe(0);
    expect(state.controller.authority.authorize(identity())).toBeUndefined();
    expect(state.api.action.badges).toContainEqual({
      tabId: 7,
      text: "!",
    });
  });

  it("requires and reconciles the complete page plus network authority set", async () => {
    const api = new FakeEnablementApi();
    const catalog = createReviewedPackCatalog(
      [networkSitePack],
      { ...runtimeOptions(), allowedPermissions: ["READ", "EXTERNAL_NETWORK"] },
      [SITE_ORIGIN, NETWORK_ORIGIN],
    );
    const controller = new PackEnablementController(api, () => catalog);
    controller.start();
    await settle(controller);

    api.action.onClicked.emit({ id: 7, url: SITE_URL });
    await settle(controller);
    expect(api.permissions.requests).toEqual([
      { origins: [`${SITE_ORIGIN}/*`, `${NETWORK_ORIGIN}/*`] },
    ]);
    expect(controller.authority.authorize(identity())).toEqual({
      packTools: new Set(["mcpatch.network.search"]),
    });

    await api.permissions.remove({ origins: [`${NETWORK_ORIGIN}/*`] });
    expect(controller.authority.authorize(identity())).toBeUndefined();
    await settle(controller);
    expect(storedRecords(api)).toEqual([]);
    expect(api.scripting.registrations.size).toBe(0);
  });

  it("does not treat a manually granted optional permission as enablement", async () => {
    const api = new FakeEnablementApi();
    const site = onlySite();
    api.permissions.granted.add(site.permissionPattern);
    const controller = new PackEnablementController(api, () => testCatalog());

    controller.start();
    await settle(controller);

    expect(api.scripting.registrations.size).toBe(0);
    expect(api.storage.data).not.toHaveProperty(ENABLEMENT_STORAGE_KEY);
    expect(controller.authority.authorize(identity())).toBeUndefined();
  });

  it("revokes locally before removing a no-longer-needed permission", async () => {
    const state = await enabledSetup();
    state.api.log.length = 0;
    state.revoke.mockClear();

    state.api.action.onClicked.emit({ id: 7, url: SITE_URL });
    expect(state.controller.authority.authorize(identity())).toBeUndefined();
    expect(state.revoke).toHaveBeenCalledWith(SITE_ORIGIN);
    await settle(state.controller);

    expect(storedRecords(state.api)).toEqual([]);
    expect(state.api.scripting.registrations.size).toBe(0);
    expect(state.api.permissions.granted.size).toBe(0);
    expect(state.api.log.indexOf("scripts.unregister")).toBeLessThan(
      state.api.log.indexOf("permission.remove"),
    );
  });

  it("reconstructs authority only from storage, permission, and exact registration", async () => {
    const first = await enabledSetup();
    const restoredApi = new FakeEnablementApi();
    restoredApi.storage.data[ENABLEMENT_STORAGE_KEY] = structuredClone(
      first.api.storage.data[ENABLEMENT_STORAGE_KEY],
    );
    restoredApi.permissions.granted.add(`${SITE_ORIGIN}/*`);
    for (const [id, script] of first.api.scripting.registrations) {
      restoredApi.scripting.registrations.set(id, structuredClone(script));
    }
    const restored = new PackEnablementController(restoredApi, () =>
      testCatalog(),
    );

    expect(restored.authority.authorize(identity())).toBeUndefined();
    restored.start();
    await settle(restored);

    expect(restored.authority.authorize(identity())).toEqual({
      packTools: new Set([SITE_TOOL]),
    });
    expect(restoredApi.permissions.requests).toEqual([]);
  });

  it("repairs a mismatched managed registration before granting authority", async () => {
    const api = new FakeEnablementApi();
    const site = onlySite();
    api.storage.data[ENABLEMENT_STORAGE_KEY] = {
      stateVersion: 1,
      enabled: [recordForSite(site)],
    };
    api.permissions.granted.add(site.permissionPattern);
    api.scripting.registrations.set(site.registrationId, {
      ...expectedRegistration(site),
      js: ["unexpected.js"],
    });
    const controller = new PackEnablementController(api, () => testCatalog());

    controller.start();
    await settle(controller);

    expect(api.log).toContain("scripts.unregister");
    expect(api.log).toContain("scripts.register");
    expect(api.scripting.registrations.get(site.registrationId)).toEqual(
      expectedRegistration(site),
    );
    expect(controller.authority.authorize(identity())).toBeDefined();
  });

  it("fails closed on corrupt storage and removes stale managed scripts", async () => {
    const api = new FakeEnablementApi();
    const site = onlySite();
    api.storage.data[ENABLEMENT_STORAGE_KEY] = {
      stateVersion: 1,
      enabled: [{ ...recordForSite(site), origin: "https://*.example.com" }],
    };
    api.permissions.granted.add(site.permissionPattern);
    api.scripting.registrations.set(
      site.registrationId,
      expectedRegistration(site),
    );
    const controller = new PackEnablementController(api, () => testCatalog());

    controller.start();
    await settle(controller);

    expect(api.storage.data).not.toHaveProperty(ENABLEMENT_STORAGE_KEY);
    expect(api.scripting.registrations.size).toBe(0);
    expect(controller.authority.authorize(identity())).toBeUndefined();
  });

  it("revokes and cleans persisted state when Chromium removes permission", async () => {
    const state = await enabledSetup();
    state.revoke.mockClear();

    await state.api.permissions.remove({
      origins: [state.site.permissionPattern],
    });
    expect(state.controller.authority.authorize(identity())).toBeUndefined();
    expect(state.revoke).toHaveBeenCalledWith(SITE_ORIGIN);
    await settle(state.controller);

    expect(storedRecords(state.api)).toEqual([]);
    expect(state.api.scripting.registrations.size).toBe(0);
  });

  it("revokes synchronously when live storage changes and cleans corruption", async () => {
    const state = await enabledSetup();
    state.revoke.mockClear();

    await state.api.storage.local.set({
      [ENABLEMENT_STORAGE_KEY]: {
        stateVersion: 1,
        enabled: [
          { ...recordForSite(state.site), origin: "https://*.example.com" },
        ],
      },
    });

    expect(state.controller.authority.authorize(identity())).toBeUndefined();
    expect(state.revoke).toHaveBeenCalledWith(SITE_ORIGIN);
    await settle(state.controller);
    expect(state.api.storage.data).not.toHaveProperty(ENABLEMENT_STORAGE_KEY);
    expect(state.api.scripting.registrations.size).toBe(0);
  });

  it("coalesces rapid clicks into one permission request", async () => {
    const state = await setup();

    state.api.action.onClicked.emit({ id: 7, url: SITE_URL });
    state.api.action.onClicked.emit({ id: 7, url: SITE_URL });
    expect(state.api.permissions.requests).toHaveLength(1);
    await settle(state.controller);
    expect(storedRecords(state.api)).toHaveLength(1);
  });

  it("remains unavailable when trusted-only storage cannot be established", async () => {
    const api = new FakeEnablementApi();
    const site = onlySite();
    api.storage.throwAccess = true;
    api.scripting.registrations.set(
      site.registrationId,
      expectedRegistration(site),
    );
    const controller = new PackEnablementController(api, () => testCatalog());

    controller.start();
    await settle(controller);
    api.action.onClicked.emit({ id: 7, url: SITE_URL });
    await settle(controller);

    expect(api.permissions.requests).toEqual([]);
    expect(api.scripting.registrations.size).toBe(0);
    expect(controller.authority.authorize(identity())).toBeUndefined();
  });

  it("does not request authority for unsupported pages", async () => {
    const state = await setup();

    state.api.action.onClicked.emit({
      id: 7,
      url: "https://attacker.example/",
    });
    state.api.action.onClicked.emit({ id: 8, url: `${SITE_ORIGIN}/outside` });
    state.api.action.onClicked.emit({ id: -1, url: SITE_URL });
    await settle(state.controller);

    expect(state.api.permissions.requests).toEqual([]);
  });

  it("does not choose between ambiguous matching packs", async () => {
    const api = new FakeEnablementApi();
    const catalog = testCatalog();
    const site = catalog.sites[0];
    if (site === undefined) throw new Error("missing site fixture");
    const controller = new PackEnablementController(api, () => ({
      sites: catalog.sites,
      match() {
        return [site, site];
      },
      resolve(record) {
        return catalog.resolve(record);
      },
    }));
    controller.start();
    await settle(controller);

    api.action.onClicked.emit({ id: 7, url: SITE_URL });
    await settle(controller);

    expect(api.permissions.requests).toEqual([]);
  });
});

async function setup() {
  const api = new FakeEnablementApi();
  const catalog = testCatalog();
  const site = catalog.sites[0];
  if (site === undefined) throw new Error("missing site fixture");
  const revoke = vi.fn<(origin: string) => void>();
  const controller = new PackEnablementController(api, () => catalog);
  controller.setHooks({ revokeOrigin: revoke });
  controller.start();
  await settle(controller);
  return { api, controller, revoke, site };
}

async function enabledSetup() {
  const state = await setup();
  state.api.action.onClicked.emit({ id: 7, url: SITE_URL });
  await settle(state.controller);
  return state;
}

function onlySite(): ReviewedPackSite {
  const site = testCatalog().sites[0];
  if (site === undefined) throw new Error("missing site fixture");
  return site;
}

function storedRecords(api: FakeEnablementApi): readonly EnabledPackRecord[] {
  const value = api.storage.data[ENABLEMENT_STORAGE_KEY];
  if (value === undefined) return [];
  return parseEnablementState(value)?.enabled ?? [];
}

function expectedRegistration(
  site: ReviewedPackSite,
): ChromeRegisteredContentScript {
  return {
    id: site.registrationId,
    matches: [site.permissionPattern],
    js: ["content-script.js"],
    allFrames: false,
    persistAcrossSessions: true,
    runAt: "document_start",
    world: "ISOLATED",
  };
}

function identity() {
  return {
    tabId: 7,
    documentId: "document-1",
    origin: SITE_ORIGIN,
    url: SITE_URL,
  };
}

async function settle(controller: PackEnablementController): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve();
    await controller.idle();
  }
}
