import { describe, expect, it, vi } from "vitest";

import type { DeclarativePackBundleContent } from "@mcpatch/sdk/runtime";

import { LocalPackController } from "../src/local-pack-controller.js";
import { PackContentCatalog } from "../src/pack-content-catalog.js";
import {
  LOCAL_CANDIDATE_TTL_MS,
  LOCAL_PACK_STORAGE_KEY,
  LOCAL_PACK_TRUST,
  type ChromeLocalPackApi,
  type ChromeMessageSender,
  type ChromeRuntimeMessageApi,
  type LocalPackResult,
  type LocalPackSummary,
} from "../src/local-pack-model.js";
import { parseLocalPackState } from "../src/local-pack-storage.js";
import { FakeEnablementApi } from "./support/enablement.js";
import { FakeChromeEvent } from "./support/native-session.js";
import {
  bundleBase64,
  LOCAL_ORIGIN,
  LOCAL_TOOL,
  LOCAL_URL,
  localBundle,
} from "./support/local-pack.js";

describe("local unsigned pack developer mode", () => {
  it("requires explicit developer opt-in and an exact browser origin grant", async () => {
    const state = setup();
    await settle(state.controller);
    const bundle = await localBundle();

    expect(await state.message(preview(bundle))).toMatchObject({
      ok: false,
      error: { code: "DEVELOPER_MODE_REQUIRED" },
    });
    await enableDeveloperMode(state);
    const candidate = await previewBundle(state, bundle);
    expect(candidate).toMatchObject({
      trust: LOCAL_PACK_TRUST,
      digest: bundle.manifest.digest,
      origins: [LOCAL_ORIGIN],
      tools: [{ name: LOCAL_TOOL, risk: "read", permissions: ["READ"] }],
      replacement: false,
    });

    expect(
      await state.message(install(candidate.candidateToken)),
    ).toMatchObject({
      ok: false,
      error: { code: "PERMISSION_REQUIRED" },
    });
    expect(stored(state.api).packs).toEqual([]);

    state.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    const secondCandidate = await previewBundle(state, bundle);
    const installed = await state.message<LocalPackSummary>(
      install(secondCandidate.candidateToken),
    );
    expect(installed).toMatchObject({
      ok: true,
      value: { enabled: true, trust: LOCAL_PACK_TRUST },
    });
    expect(stored(state.api).packs).toHaveLength(1);
    expect(state.api.scripting.registrations.size).toBe(1);
    expect(state.replaceBundles).toHaveBeenLastCalledWith([bundle]);
    expect(state.controller.authority.authorize(pageIdentity())).toEqual({
      packTools: new Set([LOCAL_TOOL]),
    });
  });

  it("delivers validated data only to the exact authorized top-level content sender", async () => {
    const state = await installedSetup();
    const accepted = await state.message(
      { type: "local_pack_content_config" },
      contentSender(),
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: [
        {
          trust: LOCAL_PACK_TRUST,
          bundle: { manifest: { digest: state.bundle.manifest.digest } },
        },
      ],
    });
    for (const sender of [
      { ...contentSender(), id: "other-extension" },
      { ...contentSender(), frameId: 1 },
      { ...contentSender(), url: "https://attacker.example/" },
    ]) {
      expect(
        await state.message({ type: "local_pack_content_config" }, sender),
      ).toMatchObject({ ok: false, error: { code: "UNAUTHORIZED_SENDER" } });
    }
  });

  it("rejects malformed, executable-shaped, oversized, stale-digest, and incompatible content", async () => {
    const state = setup();
    await settle(state.controller);
    await enableDeveloperMode(state);

    for (const base64 of [
      Buffer.from("PK\u0003\u0004archive", "utf8").toString("base64"),
      Buffer.from(
        '{"url":"https://attacker.example/pack.js"}',
        "utf8",
      ).toString("base64"),
      Buffer.from('{"handler":"() => fetch(cookie)"}', "utf8").toString(
        "base64",
      ),
      "A".repeat(Math.ceil((1024 * 1024) / 3) * 4 + 8),
    ]) {
      expect(
        await state.message({ type: "local_pack_preview", base64 }),
      ).toMatchObject({
        ok: false,
        error: { code: expect.stringMatching(/INVALID_BUNDLE|TOO_LARGE/u) },
      });
    }

    const stale = structuredClone(await localBundle());
    (stale.metadata as { license: string }).license = "changed-after-digest";
    expect(await state.message(preview(stale))).toMatchObject({
      ok: false,
      error: { code: "DIGEST_MISMATCH" },
    });

    const incompatible = await localBundle((value) => {
      const manifest = value["manifest"] as Record<string, unknown>;
      manifest["compatibility"] = {
        runtime: { minimum: "9.0.0", maximumExclusive: "10.0.0" },
        bridgeProtocol: { minimum: 2, maximum: 2 },
      };
    });
    expect(await state.message(preview(incompatible))).toMatchObject({
      ok: false,
      error: { code: "INCOMPATIBLE" },
    });
  });

  it("rejects reviewed identity collisions and expires unconfirmed candidates", async () => {
    let now = 1_000;
    const state = setup({
      now: () => now,
      reviewedIdentities: new Set(["example/read-page"]),
    });
    await settle(state.controller);
    await enableDeveloperMode(state);
    const bundle = await localBundle();
    expect(await state.message(preview(bundle))).toMatchObject({
      ok: false,
      error: { code: "COLLISION" },
    });

    const allowed = setup({ now: () => now });
    await settle(allowed.controller);
    await enableDeveloperMode(allowed);
    const candidate = await previewBundle(allowed, bundle);
    allowed.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    now += LOCAL_CANDIDATE_TTL_MS;
    expect(
      await allowed.message(install(candidate.candidateToken)),
    ).toMatchObject({
      ok: false,
      error: { code: "CANDIDATE_EXPIRED" },
    });
  });

  it("reconciles restart and revokes corrupt storage or permission loss", async () => {
    const first = await installedSetup();
    const restored = setup();
    restored.api.storage.data[LOCAL_PACK_STORAGE_KEY] = structuredClone(
      first.api.storage.data[LOCAL_PACK_STORAGE_KEY],
    );
    restored.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    await settle(restored.controller);
    expect(
      restored.controller.authority.authorize(pageIdentity()),
    ).toBeDefined();
    expect(restored.replaceBundles).toHaveBeenLastCalledWith([first.bundle]);

    await restored.api.permissions.remove({ origins: [`${LOCAL_ORIGIN}/*`] });
    expect(
      restored.controller.authority.authorize(pageIdentity()),
    ).toBeUndefined();
    expect(restored.revoke).toHaveBeenCalledWith(LOCAL_ORIGIN);
    await settle(restored.controller);
    expect(stored(restored.api).packs[0]?.enabled).toBe(false);
    expect(restored.api.scripting.registrations.size).toBe(0);

    restored.api.storage.data[LOCAL_PACK_STORAGE_KEY] = {
      stateVersion: 1,
      developerMode: true,
      packs: [{ executable: "javascript" }],
    };
    restored.api.storage.onChanged.emit(
      { [LOCAL_PACK_STORAGE_KEY]: { newValue: { corrupt: true } } },
      "local",
    );
    await settle(restored.controller);
    expect(restored.api.storage.data).not.toHaveProperty(
      LOCAL_PACK_STORAGE_KEY,
    );
    expect(
      restored.controller.authority.authorize(pageIdentity()),
    ).toBeUndefined();
  });

  it("holds an early content request until restart reconciliation completes", async () => {
    const first = await installedSetup();
    const restored = setup();
    restored.api.storage.data[LOCAL_PACK_STORAGE_KEY] = structuredClone(
      first.api.storage.data[LOCAL_PACK_STORAGE_KEY],
    );
    restored.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);

    await expect(
      restored.message({ type: "local_pack_content_config" }, contentSender()),
    ).resolves.toMatchObject({
      ok: true,
      value: [
        {
          bundle: { manifest: { digest: first.bundle.manifest.digest } },
        },
      ],
    });
  });

  it("requires confirmation for replacement and revokes before publishing changed bytes", async () => {
    const state = await installedSetup();
    state.api.log.length = 0;
    state.revoke.mockClear();
    const replacementBundle = await localBundle((value) => {
      (value["metadata"] as Record<string, unknown>)["license"] = "Apache-2.0";
    });
    const candidate = await previewBundle(state, replacementBundle);
    expect(candidate.replacement).toBe(true);
    expect(candidate.digest).not.toBe(state.bundle.manifest.digest);
    expect(stored(state.api).packs[0]?.bundle.manifest.digest).toBe(
      state.bundle.manifest.digest,
    );

    const result = await state.message<LocalPackSummary>(
      install(candidate.candidateToken),
    );
    expect(result).toMatchObject({
      ok: true,
      value: { digest: replacementBundle.manifest.digest },
    });
    expect(state.revoke).toHaveBeenCalledWith(LOCAL_ORIGIN);
    expect(stored(state.api).packs[0]?.bundle.manifest.digest).toBe(
      replacementBundle.manifest.digest,
    );
  });

  it("revokes existing authority when replacement persistence fails", async () => {
    const state = await installedSetup();
    const replacementBundle = await localBundle((value) => {
      (value["metadata"] as Record<string, unknown>)["license"] = "Apache-2.0";
    });
    const candidate = await previewBundle(state, replacementBundle);
    state.revoke.mockClear();
    state.api.storage.throwSet = true;

    expect(
      await state.message(install(candidate.candidateToken)),
    ).toMatchObject({ ok: false, error: { code: "STORAGE_INVALID" } });
    expect(state.revoke).toHaveBeenCalledWith(LOCAL_ORIGIN);
    expect(
      state.controller.authority.authorize(pageIdentity()),
    ).toBeUndefined();
    expect(state.replaceBundles).toHaveBeenLastCalledWith([]);
  });

  it("disables and uninstalls deterministically with revocation before cleanup", async () => {
    const state = await installedSetup();
    const installId = stored(state.api).packs[0]?.installId;
    if (installId === undefined) throw new Error("missing install fixture");
    state.api.log.length = 0;
    state.revoke.mockClear();

    expect(
      await state.message({
        type: "local_pack_set_enabled",
        installId,
        enabled: false,
      }),
    ).toMatchObject({ ok: true, value: { enabled: false } });
    expect(state.revoke).toHaveBeenCalledWith(LOCAL_ORIGIN);
    expect(state.api.scripting.registrations.size).toBe(0);
    expect(state.api.permissions.granted).not.toContain(`${LOCAL_ORIGIN}/*`);

    state.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
    await state.message({
      type: "local_pack_set_enabled",
      installId,
      enabled: true,
    });
    state.revoke.mockClear();
    expect(
      await state.message({ type: "local_pack_uninstall", installId }),
    ).toEqual({ ok: true, value: { removed: true } });
    expect(state.revoke).toHaveBeenCalledWith(LOCAL_ORIGIN);
    expect(stored(state.api).packs).toEqual([]);
    expect(state.api.scripting.registrations.size).toBe(0);
    expect(state.api.permissions.granted).not.toContain(`${LOCAL_ORIGIN}/*`);
  });

  it("rejects malformed developer messages and unauthorized extension pages without payload echo", async () => {
    const state = setup();
    await settle(state.controller);
    const secret = "do-not-echo-this-value";
    expect(
      await state.message({
        type: "local_pack_preview",
        base64: secret,
        extra: secret,
      }),
    ).toEqual({ ok: false, error: { code: "INVALID_MESSAGE" } });
    const denied = await state.message(
      { type: "local_pack_list" },
      {
        id: "mcpatch-test",
        url: "chrome-extension://mcpatch-test/approval.html",
      },
    );
    expect(denied).toEqual({
      ok: false,
      error: { code: "UNAUTHORIZED_SENDER" },
    });
    expect(JSON.stringify(denied)).not.toContain(secret);
  });
});

interface SetupOptions {
  readonly now?: () => number;
  readonly reviewedIdentities?: ReadonlySet<string>;
}

function setup(options: SetupOptions = {}) {
  const api = new FakeLocalPackApi();
  let sequence = 0;
  const replaceBundles = vi.fn(async () => true);
  const revoke = vi.fn<(origin: string) => void>();
  const content = new PackContentCatalog(api.scripting, api.permissions);
  const controller = new LocalPackController(api, {
    content: content.createSource("declarative"),
    runtime: {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 2,
      allowedPermissions: ["READ"],
    },
    reviewedIdentities: options.reviewedIdentities ?? new Set(),
    ...(options.now === undefined ? {} : { now: options.now }),
    randomId: () => (++sequence).toString(16).padStart(32, "0"),
  });
  controller.setHooks({ replaceBundles, revokeOrigin: revoke });
  controller.start();
  return {
    api,
    controller,
    replaceBundles,
    revoke,
    message: <T = unknown>(message: unknown, sender?: ChromeMessageSender) =>
      api.message<T>(message, sender),
  };
}

async function installedSetup() {
  const state = setup();
  await settle(state.controller);
  await enableDeveloperMode(state);
  const bundle = await localBundle();
  const candidate = await previewBundle(state, bundle);
  state.api.permissions.granted.add(`${LOCAL_ORIGIN}/*`);
  await state.message(install(candidate.candidateToken));
  return { ...state, bundle };
}

async function enableDeveloperMode(state: ReturnType<typeof setup>) {
  expect(
    await state.message({
      type: "local_pack_set_developer_mode",
      enabled: true,
    }),
  ).toEqual({ ok: true, value: { developerMode: true } });
}

async function previewBundle(
  state: ReturnType<typeof setup>,
  bundle: DeclarativePackBundleContent,
) {
  const result = await state.message<
    LocalPackSummary & {
      readonly candidateToken: string;
      readonly replacement: boolean;
    }
  >(preview(bundle));
  if (!result.ok) throw new Error(`preview failed: ${result.error.code}`);
  return result.value;
}

function preview(bundle: DeclarativePackBundleContent) {
  return { type: "local_pack_preview", base64: bundleBase64(bundle) };
}

function install(candidateToken: string) {
  return { type: "local_pack_install", candidateToken };
}

function stored(api: FakeEnablementApi) {
  return (
    parseLocalPackState(api.storage.data[LOCAL_PACK_STORAGE_KEY]) ?? {
      stateVersion: 1 as const,
      developerMode: false,
      packs: [],
    }
  );
}

function pageIdentity() {
  return {
    tabId: 7,
    documentId: "document-1",
    origin: LOCAL_ORIGIN,
    url: LOCAL_URL,
  };
}

function contentSender(): ChromeMessageSender {
  return {
    id: "mcpatch-test",
    documentId: "document-1",
    frameId: 0,
    tab: { id: 7 },
    url: LOCAL_URL,
  };
}

async function settle(controller: LocalPackController): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    await controller.idle();
  }
}

class FakeLocalPackApi extends FakeEnablementApi implements ChromeLocalPackApi {
  readonly runtime = new FakeMessageRuntime();

  message<T = unknown>(
    message: unknown,
    sender: ChromeMessageSender = {
      id: this.runtime.id,
      url: this.runtime.getURL("developer.html"),
    },
  ): Promise<LocalPackResult<T>> {
    return new Promise((resolve) => {
      this.runtime.onMessage.emit(message, sender, (response) => {
        resolve(response as LocalPackResult<T>);
      });
    });
  }
}

class FakeMessageRuntime implements ChromeRuntimeMessageApi {
  readonly id = "mcpatch-test";
  readonly onMessage = new FakeChromeEvent<
    [unknown, ChromeMessageSender, (response: unknown) => void]
  >();

  getURL(path: string): string {
    return `chrome-extension://${this.id}/${path}`;
  }
}
