import { startExtensionRuntime, type ExtensionRuntimeApi } from "./runtime.js";

declare const chrome: { runtime: ExtensionRuntimeApi };

// Registration stays synchronous at module evaluation so MV3 cannot miss a wake.
startExtensionRuntime(chrome.runtime);
