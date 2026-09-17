import { demoPack } from "@mcpatch/example-packs";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";

import type { ChromeEnablementApi } from "../src/enablement-model.js";
import { PackEnablementController } from "../src/pack-enablement.js";
import { createReviewedPackCatalog } from "../src/reviewed-pack-catalog.js";
import {
  startExtensionRuntime,
  type ExtensionRuntimeApi,
} from "../src/runtime.js";
import { FIXTURE_MARKER, FIXTURE_ORIGIN } from "./fixture-constants.js";
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
const enablement = new PackEnablementController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  (configured) =>
    createReviewedPackCatalog(
      packs,
      runtimeOptions,
      [FIXTURE_ORIGIN],
      configured,
    ),
);

void FIXTURE_MARKER;
startExtensionRuntime(chrome.runtime, {
  compiledPacks: packs,
  compiledPackRuntimeOptions: runtimeOptions,
  pageAuthority: enablement.authority,
  onPageContextOwner(owner) {
    enablement.setHooks({
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
  },
});
enablement.start();
