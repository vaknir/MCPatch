import { describe, expect, it } from "vitest";

import {
  ORIGIN_CONFIG_STORAGE_KEY,
  type ConfiguredPackOrigin,
} from "../src/configured-origins.js";
import { PackEnablementController } from "../src/pack-enablement.js";
import { FakeEnablementApi } from "./support/enablement.js";
import {
  CONFIGURABLE_PLACEHOLDER,
  configurableCatalog,
  configurableSitePack,
} from "./support/site-pack.js";

const CONFIGURED = "https://jira.corp.example.com";
const PAGE = `${CONFIGURED}/app/browse/ABC-1`;

function configuration(origins: readonly string[]): unknown {
  const sites: ConfiguredPackOrigin[] = origins.map((origin) => ({
    publisher: configurableSitePack.manifest.publisher,
    id: configurableSitePack.manifest.id,
    origin,
  }));
  return { stateVersion: 1, sites };
}

async function start(api: FakeEnablementApi) {
  const controller = new PackEnablementController(api, (configured) =>
    configurableCatalog(configured.map((site) => site.origin)),
  );
  controller.start();
  await settle(controller);
  return controller;
}

async function settle(controller: PackEnablementController): Promise<void> {
  for (let index = 0; index < 8; index += 1) await controller.idle();
}

describe("configurable pack origins end to end", () => {
  it("offers nothing until the user configures an origin", async () => {
    const api = new FakeEnablementApi();
    const controller = await start(api);

    api.action.onClicked.emit({ id: 7, url: PAGE });
    await settle(controller);

    expect(api.permissions.requests).toEqual([]);
    expect(api.scripting.registrations.size).toBe(0);
  });

  it("requests only the configured origin, never the broad declaration", async () => {
    const api = new FakeEnablementApi();
    api.storage.data[ORIGIN_CONFIG_STORAGE_KEY] = configuration([CONFIGURED]);
    const controller = await start(api);

    api.action.onClicked.emit({ id: 7, url: PAGE });
    await settle(controller);

    expect(api.permissions.requests).toEqual([
      { origins: [`${CONFIGURED}/*`] },
    ]);
    expect(JSON.stringify(api.permissions.requests)).not.toContain("*/*");
    expect([...api.scripting.registrations.values()][0]?.matches).toEqual([
      `${CONFIGURED}/*`,
    ]);
    expect(controller.authority.authorize(identity())).toEqual({
      packTools: new Set(["mcpatch.site.status"]),
    });
  });

  it("refuses an all-hosts grant as authority for the configured origin", async () => {
    const api = new FakeEnablementApi();
    api.storage.data[ORIGIN_CONFIG_STORAGE_KEY] = configuration([CONFIGURED]);
    api.permissions.granted.add("https://*/*");
    const controller = await start(api);

    api.action.onClicked.emit({ id: 7, url: PAGE });
    await settle(controller);

    expect(api.scripting.registrations.size).toBe(0);
    expect(controller.authority.authorize(identity())).toBeUndefined();
  });

  it("revokes when the user removes the configured origin", async () => {
    const api = new FakeEnablementApi();
    api.storage.data[ORIGIN_CONFIG_STORAGE_KEY] = configuration([CONFIGURED]);
    const controller = await start(api);
    api.action.onClicked.emit({ id: 7, url: PAGE });
    await settle(controller);
    expect(api.scripting.registrations.size).toBe(1);

    await api.storage.local.set({
      [ORIGIN_CONFIG_STORAGE_KEY]: configuration([]),
    });
    await settle(controller);

    expect(api.scripting.registrations.size).toBe(0);
    expect(controller.authority.authorize(identity())).toBeUndefined();
  });

  it("never grants authority on the synthetic placeholder origin", async () => {
    const api = new FakeEnablementApi();
    api.storage.data[ORIGIN_CONFIG_STORAGE_KEY] = configuration([CONFIGURED]);
    const controller = await start(api);

    api.action.onClicked.emit({
      id: 7,
      url: `${CONFIGURABLE_PLACEHOLDER}/app/x`,
    });
    await settle(controller);

    expect(api.permissions.requests).toEqual([]);
  });

  it("discards a malformed stored configuration instead of trusting it", async () => {
    const api = new FakeEnablementApi();
    api.storage.data[ORIGIN_CONFIG_STORAGE_KEY] = {
      stateVersion: 1,
      sites: [{ publisher: "x", id: "y", origin: "https://*/*" }],
    };
    const controller = await start(api);

    api.action.onClicked.emit({ id: 7, url: PAGE });
    await settle(controller);

    expect(api.permissions.requests).toEqual([]);
    expect(api.storage.data).not.toHaveProperty(ORIGIN_CONFIG_STORAGE_KEY);
  });
});

function identity() {
  return { origin: CONFIGURED, url: PAGE, tabId: 7, documentId: "doc-1" };
}
