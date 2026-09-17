import { PACK_RUNTIME_OPTIONS } from "./bundled-packs.js";
import { BUNDLED_PAGE_ADAPTERS } from "./bundled-page-adapters.js";
import { PageContentRuntime } from "./page-content-runtime.js";
import type {
  ChromePageClientRuntimeApi,
  PageLifecycleApi,
} from "./page-content-model.js";
import { createNativeWebMcpAdapter } from "./native-webmcp-adapter.js";
import {
  createReviewedDocumentAdapter,
  reviewedRealmNetworkPolicy,
} from "./reviewed-page-adapter.js";
import { lockRealm } from "./realm-lockdown.js";
import {
  CompositePageAdapter,
  loadLocalPackPageAdapter,
} from "./local-pack-page-adapter.js";
import { loadCommunityPackPageAdapter } from "./community-pack-page-adapter.js";

declare const chrome: { readonly runtime: ChromePageClientRuntimeApi };

// Lock the isolated content-script realm before any pack code can run, so the
// declared-origin network bound and the no-cookie bound are enforced by
// mechanism rather than by review. A failure here is fail-closed: the realm is
// left without a running adapter and no capability snapshot is published.
async function bootstrap(): Promise<void> {
  const navigation = lockRealm(
    globalThis as unknown as Parameters<typeof lockRealm>[0],
    reviewedRealmNetworkPolicy(
      globalThis.location.href,
      BUNDLED_PAGE_ADAPTERS,
      PACK_RUNTIME_OPTIONS,
    ),
  );

  const reviewed = createReviewedDocumentAdapter(
    globalThis.document,
    globalThis.location.href,
    BUNDLED_PAGE_ADAPTERS,
    PACK_RUNTIME_OPTIONS,
    navigation,
    createNativeWebMcpAdapter(globalThis.document, globalThis.location.origin),
  );
  const local = await loadLocalPackPageAdapter(
    chrome.runtime,
    globalThis.document,
    globalThis.location,
    navigation,
  );
  const community = await loadCommunityPackPageAdapter(
    chrome.runtime,
    globalThis.document,
    globalThis.location,
    navigation,
  );
  const adapter = new CompositePageAdapter([reviewed, local, community]);
  const runtime = new PageContentRuntime(chrome.runtime, adapter, {
    expectedOrigin: globalThis.location.origin,
    lifecycle: globalThis as unknown as PageLifecycleApi,
  });
  runtime.wake();
}

void bootstrap().catch(() => {
  // Realm lockdown or adapter construction failed. Publishing nothing is the
  // safe outcome; the page keeps no MCPatch capabilities.
});
