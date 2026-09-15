import { demoPack } from "@mcpatch/example-packs";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";

import type { CompiledPackRuntimeOptions } from "./compiled-pack-validation.js";

export const BUNDLED_PACKS = Object.freeze([demoPack]);

export const PACK_RUNTIME_OPTIONS: CompiledPackRuntimeOptions = Object.freeze({
  runtimeVersion: "0.1.0",
  bridgeProtocolVersion: PROTOCOL_VERSION,
  allowedPermissions: Object.freeze(["READ"] as const),
});

// This closed list must mirror manifest.json optional_host_permissions. A reviewed
// pack cannot become user-enableable unless its exact origin is present in both.
export const DECLARED_SITE_ORIGINS = Object.freeze(["https://www.google.com"]);
