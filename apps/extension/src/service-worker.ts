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
import type { PageAuthority } from "./page-context-model.js";
import type { PageContextOwner } from "./page-context-owner.js";
import type { CompiledPackRuntime } from "./compiled-pack-runtime.js";

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
const enablement = new PackEnablementController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  catalog,
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
    runtime: PACK_RUNTIME_OPTIONS,
    reviewedIdentities: new Set(
      catalog.sites.map(
        (site) => `${site.manifest.publisher}/${site.manifest.id}`,
      ),
    ),
  },
);
let runtimePackRuntime: CompiledPackRuntime | undefined;
let pageContextOwner: PageContextOwner | undefined;

// Registration stays synchronous at module evaluation so MV3 cannot miss a wake.
startExtensionRuntime(chrome.runtime, {
  approvalSurface: new ApprovalController(chrome.runtime, chrome.tabs),
  pageAuthority: combinePageAuthorities([
    enablement.authority,
    localPacks.authority,
  ]),
  onPackRuntime(runtime) {
    runtimePackRuntime = runtime;
    updateLocalPackHooks();
  },
  onPageContextOwner(owner) {
    pageContextOwner = owner;
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

function combinePageAuthorities(
  authorities: readonly PageAuthority[],
): PageAuthority {
  return Object.freeze({
    authorize(identity: Parameters<PageAuthority["authorize"]>[0]) {
      const tools = new Set<string>();
      for (const authority of authorities) {
        const authorization = authority.authorize(identity);
        if (authorization === undefined) continue;
        for (const tool of authorization.packTools) tools.add(tool);
      }
      return tools.size === 0 ? undefined : Object.freeze({ packTools: tools });
    },
  });
}
