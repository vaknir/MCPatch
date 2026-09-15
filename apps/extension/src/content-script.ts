import {
  emptyPageAdapter,
  PageContentRuntime,
} from "./page-content-runtime.js";
import type {
  ChromePageClientRuntimeApi,
  PageLifecycleApi,
} from "./page-content-model.js";
import { createNativeWebMcpAdapter } from "./native-webmcp-adapter.js";

declare const chrome: { readonly runtime: ChromePageClientRuntimeApi };

const adapter =
  createNativeWebMcpAdapter(globalThis.document, globalThis.location.origin) ??
  emptyPageAdapter;
const runtime = new PageContentRuntime(chrome.runtime, adapter, {
  expectedOrigin: globalThis.location.origin,
  lifecycle: globalThis as unknown as PageLifecycleApi,
});
runtime.wake();
