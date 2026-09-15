import { PageContentRuntime } from "../src/page-content-runtime.js";
import type { ChromePageClientRuntimeApi } from "../src/page-content-model.js";
import { MCPATCH_PAGE_PORT_NAME } from "../src/page-context-model.js";
import { FIXTURE_MARKER } from "./fixture-constants.js";
import { createFixturePageAdapter } from "./fixture-page-adapter.js";

declare const chrome: { readonly runtime: ChromePageClientRuntimeApi };

void FIXTURE_MARKER;

if (globalThis.location.pathname === "/malformed") {
  const port = chrome.runtime.connect({ name: MCPATCH_PAGE_PORT_NAME });
  port.postMessage("{malformed-fixture-frame");
} else {
  const runtime = new PageContentRuntime(
    chrome.runtime,
    createFixturePageAdapter(globalThis.document),
    {
      expectedOrigin: globalThis.location.origin,
      lifecycle: globalThis,
    },
  );
  runtime.wake();
}
