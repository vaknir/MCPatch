import { PageContentRuntime } from "../src/page-content-runtime.js";
import type { ChromePageClientRuntimeApi } from "../src/page-content-model.js";
import { MCPATCH_PAGE_PORT_NAME } from "../src/page-context-model.js";
import {
  COMMUNITY_ORIGIN,
  FIXTURE_MARKER,
  FIXTURE_ORIGIN,
} from "./fixture-constants.js";
import { createFixturePageAdapter } from "./fixture-page-adapter.js";
import { lockRealm } from "../src/realm-lockdown.js";
import { DeclarativeDomAdapter } from "../src/declarative-dom-adapter.js";
import {
  createDeclarativePageAdapter,
  DeclarativePackRuntime,
} from "../src/declarative-pack-runtime.js";
import { CompositePageAdapter } from "../src/local-pack-page-adapter.js";
import { fixtureLocalBundle } from "./fixture-local-bundle.js";
import { loadCommunityPackPageAdapter } from "../src/community-pack-page-adapter.js";

declare const chrome: { readonly runtime: ChromePageClientRuntimeApi };

void FIXTURE_MARKER;

if (
  globalThis.location.origin === FIXTURE_ORIGIN &&
  globalThis.location.pathname === "/malformed"
) {
  const port = chrome.runtime.connect({ name: MCPATCH_PAGE_PORT_NAME });
  port.postMessage("{malformed-fixture-frame");
} else {
  globalThis.document.documentElement.dataset["fixtureRuntime"] = "loaded";
  // Lock the isolated realm before any pack code runs, exactly as the
  // production content script does, declaring the fixture origin as the only
  // allowed request origin.
  try {
    lockRealm(globalThis as unknown as Parameters<typeof lockRealm>[0], {
      allowedOrigins: [globalThis.location.origin],
    });
  } catch (error: unknown) {
    globalThis.document.documentElement.dataset["fixtureRuntime"] =
      error instanceof Error ? `${error.name}:${error.message}` : "lock-failed";
    throw error;
  }
  void startFixtureRuntime().then(
    () => {
      globalThis.document.documentElement.dataset["fixtureRuntime"] = "ready";
    },
    (error: unknown) => {
      globalThis.document.documentElement.dataset["fixtureRuntime"] =
        error instanceof Error ? `${error.name}:${error.message}` : "failed";
    },
  );
}

async function startFixtureRuntime(): Promise<void> {
  if (globalThis.location.origin === COMMUNITY_ORIGIN) {
    const adapter = await loadCommunityPackPageAdapter(
      chrome.runtime,
      globalThis.document,
      globalThis.location,
    );
    const runtime = new PageContentRuntime(chrome.runtime, adapter, {
      expectedOrigin: COMMUNITY_ORIGIN,
      lifecycle: globalThis,
    });
    runtime.wake();
    return;
  }
  if (globalThis.location.origin !== FIXTURE_ORIGIN) {
    throw new TypeError("fixture content origin mismatch");
  }
  const binding = Object.freeze({
    bundleDigest: fixtureLocalBundle.manifest.digest,
    contextId: "local.fixture",
    contextRevision: 1,
    documentId: "local-document.fixture",
    origin: FIXTURE_ORIGIN,
    path: globalThis.location.pathname,
    tabId: 0,
  });
  const declarative = await DeclarativePackRuntime.create({
    binding,
    bundle: fixtureLocalBundle,
    currentBinding() {
      return globalThis.location.origin === binding.origin &&
        globalThis.location.pathname === binding.path
        ? binding
        : undefined;
    },
    document: new DeclarativeDomAdapter(globalThis.document),
  });
  const runtime = new PageContentRuntime(
    chrome.runtime,
    new CompositePageAdapter([
      createFixturePageAdapter(globalThis.document),
      createDeclarativePageAdapter(declarative),
    ]),
    {
      expectedOrigin: globalThis.location.origin,
      lifecycle: globalThis,
    },
  );
  runtime.wake();
}
