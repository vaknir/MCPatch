import { startExtensionRuntime, type ExtensionRuntimeApi } from "./runtime.js";
import { ApprovalController } from "./approval-controller.js";
import type {
  ChromeApprovalRuntimeApi,
  ChromeApprovalTabsApi,
} from "./approval-model.js";
import {
  BUNDLED_PACKS,
  DECLARED_SITE_ORIGINS,
  PACK_RUNTIME_OPTIONS,
} from "./bundled-packs.js";
import type { ChromeEnablementApi } from "./enablement-model.js";
import { PackEnablementController } from "./pack-enablement.js";
import { createReviewedPackCatalog } from "./reviewed-pack-catalog.js";

declare const chrome: Omit<ChromeEnablementApi, "lifecycle"> & {
  readonly runtime: ExtensionRuntimeApi & ChromeApprovalRuntimeApi;
  readonly tabs: ChromeApprovalTabsApi;
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
  approvalSurface: new ApprovalController(chrome.runtime, chrome.tabs),
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
