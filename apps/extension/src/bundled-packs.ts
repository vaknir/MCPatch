import { demoPack } from "@mcpatch/example-packs";
import {
  GOOGLE_FLIGHTS_ORIGIN,
  googleFlightsBrowserPack,
} from "@mcpatch/google-flights-pack";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";
import {
  TRADINGVIEW_ORIGIN,
  TRADINGVIEW_PRICE_ALERTS_ORIGIN,
  TRADINGVIEW_SYMBOL_SEARCH_ORIGIN,
  tradingViewBrowserPack,
} from "@mcpatch/tradingview-pack";

import type { CompiledPackRuntimeOptions } from "./compiled-pack-validation.js";

export const BUNDLED_PACKS = Object.freeze([
  demoPack,
  googleFlightsBrowserPack.definition,
  tradingViewBrowserPack.definition,
]);

export const PACK_RUNTIME_OPTIONS: CompiledPackRuntimeOptions = Object.freeze({
  runtimeVersion: "0.1.0",
  bridgeProtocolVersion: PROTOCOL_VERSION,
  allowedPermissions: Object.freeze([
    "READ",
    "ACTION",
    "EXTERNAL_NETWORK",
  ] as const),
});

// This closed list must mirror manifest.json optional_host_permissions. A reviewed
// pack cannot become user-enableable unless its exact origin is present in both.
export const DECLARED_OPTIONAL_ORIGINS = Object.freeze([
  GOOGLE_FLIGHTS_ORIGIN,
  TRADINGVIEW_ORIGIN,
  TRADINGVIEW_PRICE_ALERTS_ORIGIN,
  TRADINGVIEW_SYMBOL_SEARCH_ORIGIN,
]);
