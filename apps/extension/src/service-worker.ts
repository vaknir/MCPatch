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
import type { ConfiguredPackOrigin } from "./configured-origins.js";
import { LocalPackController } from "./local-pack-controller.js";
import type { ChromeRuntimeMessageApi } from "./local-pack-model.js";
import type { PageContextOwner } from "./page-context-owner.js";
import { PackContentCatalog } from "./pack-content-catalog.js";
import { CommunityPackController } from "./community-pack-controller.js";
import { CommunityRegistryClient } from "./community-registry-client.js";
import type { RegistryFetch } from "./community-registry-client.js";
import {
  COMMUNITY_REGISTRY_ID,
  COMMUNITY_REGISTRY_INDEX_PATH,
  COMMUNITY_REGISTRY_ORIGIN,
  COMMUNITY_REGISTRY_PUBLIC_KEY,
} from "./community-registry-config.js";
import { DeclarativeDefinitionCatalog } from "./declarative-definition-catalog.js";

declare const chrome: Omit<ChromeEnablementApi, "lifecycle"> & {
  readonly runtime: ExtensionRuntimeApi &
    ChromeApprovalRuntimeApi &
    ChromeRuntimeMessageApi;
  readonly tabs: ChromeApprovalTabsApi;
};

const createCatalog = (configured: readonly ConfiguredPackOrigin[]) =>
  createReviewedPackCatalog(
    BUNDLED_PACKS,
    PACK_RUNTIME_OPTIONS,
    DECLARED_OPTIONAL_ORIGINS,
    configured,
  );
const contentCatalog = new PackContentCatalog(
  chrome.scripting,
  chrome.permissions,
);
const reviewedContent = contentCatalog.createSource("reviewed");
const localContent = contentCatalog.createSource("local");
const communityContent = contentCatalog.createSource("community");
const definitions = new DeclarativeDefinitionCatalog();
const localDefinitions = definitions.createSource("local");
const communityDefinitions = definitions.createSource("community");
const reviewedIdentities = new Set(
  BUNDLED_PACKS.map((pack) => `${pack.manifest.publisher}/${pack.manifest.id}`),
);
const registryClient = new CommunityRegistryClient(
  {
    origin: COMMUNITY_REGISTRY_ORIGIN,
    indexPath: COMMUNITY_REGISTRY_INDEX_PATH,
    registryId: COMMUNITY_REGISTRY_ID,
    publicKey: COMMUNITY_REGISTRY_PUBLIC_KEY,
  },
  PACK_RUNTIME_OPTIONS,
  ((url, init) => fetch(url, init)) as RegistryFetch,
);
const communityPacks = new CommunityPackController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    runtime: chrome.runtime,
    storage: chrome.storage,
    tabs: chrome.tabs,
  },
  {
    client: registryClient,
    content: communityContent,
    definitions: communityDefinitions,
    reviewedIdentities,
  },
);
const enablement = new PackEnablementController(
  {
    action: chrome.action,
    lifecycle: chrome.runtime,
    permissions: chrome.permissions,
    scripting: chrome.scripting,
    storage: chrome.storage,
  },
  createCatalog,
  reviewedContent,
  (tab) => communityPacks.handleAction(tab),
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
    content: localContent,
    runtime: PACK_RUNTIME_OPTIONS,
    reviewedIdentities,
  },
);
contentCatalog.setAuthorities([
  enablement.authority,
  localPacks.authority,
  communityPacks.authority,
]);
let pageContextOwner: PageContextOwner | undefined;

// Registration stays synchronous at module evaluation so MV3 cannot miss a wake.
startExtensionRuntime(chrome.runtime, {
  approvalSurface: new ApprovalController(chrome.runtime, chrome.tabs),
  pageAuthority: contentCatalog.authority,
  onPackRuntime(runtime) {
    definitions.setRuntime(runtime);
  },
  onPageContextOwner(owner) {
    pageContextOwner = owner;
    contentCatalog.setRevokeOrigin((origin) => owner.revokeOrigin(origin));
    enablement.setHooks({
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
    communityPacks.setHooks({
      audit(event) {
        console.info("MCPatch community lifecycle", event);
      },
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
    updateLocalPackHooks();
  },
});
enablement.start();
localPacks.start();
communityPacks.start();

function updateLocalPackHooks(): void {
  localPacks.setHooks({
    replaceBundles: async (bundles) => {
      return localDefinitions.replace(bundles);
    },
    revokeOrigin(origin) {
      pageContextOwner?.revokeOrigin(origin);
    },
  });
}
