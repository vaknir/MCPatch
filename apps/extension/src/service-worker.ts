import {
  registerLifecycleListeners,
  type ChromeRuntimeLifecycleApi,
} from "./lifecycle.js";

declare const chrome: { runtime: ChromeRuntimeLifecycleApi };

// Registration stays synchronous at module evaluation so MV3 cannot miss a wake.
// The native connection supervisor will replace this no-op hook in issue #38.
registerLifecycleListeners(chrome.runtime, () => undefined);
