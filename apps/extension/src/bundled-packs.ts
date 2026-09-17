import { demoPack } from "@mcpatch/example-packs";
import {
  GOOGLE_FLIGHTS_ORIGIN,
  googleFlightsBrowserPack,
} from "@mcpatch/google-flights-pack";
import { jiraBrowserPack } from "@mcpatch/jira-pack";
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
  jiraBrowserPack.definition,
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
// A pack with a self-hosted deployment origin, such as Jira Data Center, is not
// listed here: its origin is configured by the user at runtime, expressed through
// the broad optional declaration, and proved exactly at enablement. See
// docs/adr/0015-configurable-pack-origins.md.
export const DECLARED_OPTIONAL_ORIGINS = Object.freeze([
  GOOGLE_FLIGHTS_ORIGIN,
  TRADINGVIEW_ORIGIN,
  TRADINGVIEW_PRICE_ALERTS_ORIGIN,
  TRADINGVIEW_SYMBOL_SEARCH_ORIGIN,
]);

// The narrowest platform pattern that can express an arbitrary runtime-selected
// HTTPS host. It is a declaration, never a request: enablement asks only for the
// exact configured origin, and proof rejects this pattern if it is ever granted.
export const CONFIGURABLE_ORIGIN_DECLARATION = "https://*/*";
