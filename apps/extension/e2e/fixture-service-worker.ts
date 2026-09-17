import { demoPack } from "@mcpatch/example-packs";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";

import type { ChromeEnablementApi } from "../src/enablement-model.js";
import { PackEnablementController } from "../src/pack-enablement.js";
import { PackContentCatalog } from "../src/pack-content-catalog.js";
import { createReviewedPackCatalog } from "../src/reviewed-pack-catalog.js";
import {
  startExtensionRuntime,
  type ExtensionRuntimeApi,
} from "../src/runtime.js";
import {
  FIXTURE_LOCAL_TOOL,
  FIXTURE_MARKER,
  FIXTURE_ORIGIN,
} from "./fixture-constants.js";
import { fixtureLocalBundle } from "./fixture-local-bundle.js";
import { fixturePack } from "./fixture-pack.js";

declare const chrome: Omit<ChromeEnablementApi, "lifecycle"> & {
  readonly runtime: ExtensionRuntimeApi;
};

const packs = Object.freeze([demoPack, fixturePack]);
const runtimeOptions = Object.freeze({
  runtimeVersion: "0.1.0",
  bridgeProtocolVersion: PROTOCOL_VERSION,
  allowedPermissions: Object.freeze(["READ"] as const),
});
const contentCatalog = new PackContentCatalog(
  chrome.scripting,
  chrome.permissions,
);
const enablement = new PackEnablementController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  createReviewedPackCatalog(packs, runtimeOptions, [FIXTURE_ORIGIN]),
  contentCatalog.createSource("reviewed"),
);
contentCatalog.setAuthorities([
  {
    authorize(identity) {
      const authorization = enablement.authority.authorize(identity);
      if (authorization === undefined) return undefined;
      return Object.freeze({
        packTools: new Set([...authorization.packTools, FIXTURE_LOCAL_TOOL]),
      });
    },
  },
]);

void FIXTURE_MARKER;
startExtensionRuntime(chrome.runtime, {
  compiledPacks: packs,
  compiledPackRuntimeOptions: runtimeOptions,
  pageAuthority: contentCatalog.authority,
  onPackRuntime(runtime) {
    void runtime.replaceDeclarativeDefinitions([fixtureLocalBundle]);
  },
  onPageContextOwner(owner) {
    contentCatalog.setRevokeOrigin((origin) => owner.revokeOrigin(origin));
    enablement.setHooks({
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
  },
});
enablement.start();
