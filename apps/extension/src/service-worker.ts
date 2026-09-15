import { startExtensionRuntime, type ExtensionRuntimeApi } from "./runtime.js";
import {
  BUNDLED_PACKS,
  DECLARED_SITE_ORIGINS,
  PACK_RUNTIME_OPTIONS,
} from "./bundled-packs.js";
import type { ChromeEnablementApi } from "./enablement-model.js";
import { PackEnablementController } from "./pack-enablement.js";
import { createReviewedPackCatalog } from "./reviewed-pack-catalog.js";

declare const chrome: Omit<ChromeEnablementApi, "lifecycle"> & {
  readonly runtime: ExtensionRuntimeApi;
};

const enablement = new PackEnablementController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  createReviewedPackCatalog(
    BUNDLED_PACKS,
    PACK_RUNTIME_OPTIONS,
    DECLARED_SITE_ORIGINS,
  ),
);

// Registration stays synchronous at module evaluation so MV3 cannot miss a wake.
startExtensionRuntime(chrome.runtime, {
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
