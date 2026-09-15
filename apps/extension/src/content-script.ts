import {
  emptyPageAdapter,
  PageContentRuntime,
} from "./page-content-runtime.js";
import type {
  ChromePageClientRuntimeApi,
  PageLifecycleApi,
} from "./page-content-model.js";

declare const chrome: { readonly runtime: ChromePageClientRuntimeApi };

const runtime = new PageContentRuntime(chrome.runtime, emptyPageAdapter, {
  expectedOrigin: globalThis.location.origin,
  lifecycle: globalThis as unknown as PageLifecycleApi,
});
runtime.wake();
