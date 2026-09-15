import { PACK_RUNTIME_OPTIONS } from "./bundled-packs.js";
import { BUNDLED_PAGE_ADAPTERS } from "./bundled-page-adapters.js";
import { PageContentRuntime } from "./page-content-runtime.js";
import type {
  ChromePageClientRuntimeApi,
  PageLifecycleApi,
} from "./page-content-model.js";
import { createNativeWebMcpAdapter } from "./native-webmcp-adapter.js";
import { createReviewedDocumentAdapter } from "./reviewed-page-adapter.js";

declare const chrome: { readonly runtime: ChromePageClientRuntimeApi };

const adapter = createReviewedDocumentAdapter(
  globalThis.document,
  globalThis.location.href,
  BUNDLED_PAGE_ADAPTERS,
  PACK_RUNTIME_OPTIONS,
  createNativeWebMcpAdapter(globalThis.document, globalThis.location.origin),
);
const runtime = new PageContentRuntime(chrome.runtime, adapter, {
  expectedOrigin: globalThis.location.origin,
  lifecycle: globalThis as unknown as PageLifecycleApi,
});
runtime.wake();
