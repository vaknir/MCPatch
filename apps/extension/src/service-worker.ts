import { startExtensionRuntime, type ExtensionRuntimeApi } from "./runtime.js";
import { ApprovalController } from "./approval-controller.js";
import type {
  ChromeApprovalRuntimeApi,
  ChromeApprovalTabsApi,
} from "./approval-model.js";
import {
  BUNDLED_PACKS,
  DECLARED_OPTIONAL_ORIGINS,
  PACK_RUNTIME_OPTIONS,
} from "./bundled-packs.js";
import type { ChromeEnablementApi } from "./enablement-model.js";
import { PackEnablementController } from "./pack-enablement.js";
import { createReviewedPackCatalog } from "./reviewed-pack-catalog.js";
import { LocalPackController } from "./local-pack-controller.js";
import type { ChromeRuntimeMessageApi } from "./local-pack-model.js";
import type { PageContextOwner } from "./page-context-owner.js";
import type { CompiledPackRuntime } from "./compiled-pack-runtime.js";
import { PackContentCatalog } from "./pack-content-catalog.js";

declare const chrome: Omit<ChromeEnablementApi, "lifecycle"> & {
  readonly runtime: ExtensionRuntimeApi &
    ChromeApprovalRuntimeApi &
    ChromeRuntimeMessageApi;
  readonly tabs: ChromeApprovalTabsApi;
};

const catalog = createReviewedPackCatalog(
  BUNDLED_PACKS,
  PACK_RUNTIME_OPTIONS,
  DECLARED_OPTIONAL_ORIGINS,
);
const contentCatalog = new PackContentCatalog(
  chrome.scripting,
  chrome.permissions,
);
const reviewedContent = contentCatalog.createSource("reviewed");
const declarativeContent = contentCatalog.createSource("declarative");
const enablement = new PackEnablementController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  catalog,
  reviewedContent,
);
const localPacks = new LocalPackController(
  {
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    runtime: chrome.runtime,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  {
    content: declarativeContent,
    runtime: PACK_RUNTIME_OPTIONS,
    reviewedIdentities: new Set(
      catalog.sites.map(
        (site) => `${site.manifest.publisher}/${site.manifest.id}`,
      ),
    ),
  },
);
contentCatalog.setAuthorities([enablement.authority, localPacks.authority]);
let runtimePackRuntime: CompiledPackRuntime | undefined;
let pageContextOwner: PageContextOwner | undefined;

// Registration stays synchronous at module evaluation so MV3 cannot miss a wake.
startExtensionRuntime(chrome.runtime, {
  approvalSurface: new ApprovalController(chrome.runtime, chrome.tabs),
  pageAuthority: contentCatalog.authority,
  onPackRuntime(runtime) {
    runtimePackRuntime = runtime;
    updateLocalPackHooks();
  },
  onPageContextOwner(owner) {
    pageContextOwner = owner;
    contentCatalog.setRevokeOrigin((origin) => owner.revokeOrigin(origin));
    enablement.setHooks({
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
    updateLocalPackHooks();
  },
});
enablement.start();
localPacks.start();

function updateLocalPackHooks(): void {
  localPacks.setHooks({
    replaceBundles: async (bundles) => {
      const accepted =
        await runtimePackRuntime?.replaceDeclarativeDefinitions(bundles);
      return accepted === true;
    },
    revokeOrigin(origin) {
      pageContextOwner?.revokeOrigin(origin);
    },
  });
}
