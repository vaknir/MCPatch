import { demoPack } from "@mcpatch/example-packs";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";

import { ApprovalController } from "../src/approval-controller.js";
import type {
  ChromeApprovalRuntimeApi,
  ChromeApprovalTabsApi,
} from "../src/approval-model.js";
import type { ChromeEnablementApi } from "../src/enablement-model.js";
import { PackEnablementController } from "../src/pack-enablement.js";
import { PackContentCatalog } from "../src/pack-content-catalog.js";
import { createReviewedPackCatalog } from "../src/reviewed-pack-catalog.js";
import { CommunityPackController } from "../src/community-pack-controller.js";
import { CommunityRegistryClient } from "../src/community-registry-client.js";
import type { RegistryFetch } from "../src/community-registry-client.js";
import { DeclarativeDefinitionCatalog } from "../src/declarative-definition-catalog.js";
import type { ChromeCommunityTabsApi } from "../src/community-pack-model.js";
import type { ChromeRuntimeMessageApi } from "../src/local-pack-model.js";
import {
  startExtensionRuntime,
  type ExtensionRuntimeApi,
} from "../src/runtime.js";
import {
  FIXTURE_LOCAL_TOOL,
  FIXTURE_MARKER,
  FIXTURE_ORIGIN,
  COMMUNITY_REGISTRY_ORIGIN,
  COMMUNITY_REGISTRY_PUBLIC_KEY,
} from "./fixture-constants.js";
import { fixtureLocalBundle } from "./fixture-local-bundle.js";
import { fixturePack } from "./fixture-pack.js";

declare const chrome: Omit<ChromeEnablementApi, "lifecycle"> & {
  readonly runtime: ExtensionRuntimeApi &
    ChromeApprovalRuntimeApi &
    ChromeRuntimeMessageApi;
  readonly tabs: ChromeApprovalTabsApi & ChromeCommunityTabsApi;
};

const packs = Object.freeze([demoPack, fixturePack]);
const runtimeOptions = Object.freeze({
  runtimeVersion: "0.1.0",
  bridgeProtocolVersion: PROTOCOL_VERSION,
  allowedPermissions: Object.freeze(["ACTION", "READ"] as const),
});
const contentCatalog = new PackContentCatalog(
  chrome.scripting,
  chrome.permissions,
);
const reviewedContent = contentCatalog.createSource("reviewed");
const communityContent = contentCatalog.createSource("community");
const definitions = new DeclarativeDefinitionCatalog();
const localDefinitions = definitions.createSource("fixture-local");
const communityDefinitions = definitions.createSource("community");
const registryClient = new CommunityRegistryClient(
  {
    origin: COMMUNITY_REGISTRY_ORIGIN,
    indexPath: "/v1/index.json",
    registryId: "mcpatch-registry",
    publicKey: COMMUNITY_REGISTRY_PUBLIC_KEY,
  },
  runtimeOptions,
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
    reviewedIdentities: new Set(
      packs.map((pack) => `${pack.manifest.publisher}/${pack.manifest.id}`),
    ),
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
  createReviewedPackCatalog(packs, runtimeOptions, [FIXTURE_ORIGIN]),
  reviewedContent,
  (tab) => communityPacks.handleAction(tab),
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
  communityPacks.authority,
]);

void FIXTURE_MARKER;
startExtensionRuntime(chrome.runtime, {
  approvalSurface: new ApprovalController(chrome.runtime, chrome.tabs),
  compiledPacks: packs,
  compiledPackRuntimeOptions: runtimeOptions,
  pageAuthority: contentCatalog.authority,
  onPackRuntime(runtime) {
    definitions.setRuntime(runtime);
    void localDefinitions.replace([fixtureLocalBundle]);
  },
  onPageContextOwner(owner) {
    contentCatalog.setRevokeOrigin((origin) => owner.revokeOrigin(origin));
    enablement.setHooks({
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
    communityPacks.setHooks({
      revokeOrigin(origin) {
        owner.revokeOrigin(origin);
      },
    });
  },
});
enablement.start();
communityPacks.start();

// Test-only equivalent of the toolbar click; the production build never contains
// this symbol and the fixture build is permanently marked as non-shipping.
(
  globalThis as typeof globalThis & {
    __MCPATCH_FIXTURE_DISCOVER__?: (tab: {
      readonly id: number;
      readonly url: string;
    }) => void;
  }
).__MCPATCH_FIXTURE_DISCOVER__ = (tab) => communityPacks.handleAction(tab);
