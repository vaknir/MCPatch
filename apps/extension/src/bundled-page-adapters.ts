import {
  GOOGLE_FLIGHTS_TOOLS,
  googleFlightsPack,
} from "@mcpatch/google-flights-pack";

import { createGoogleFlightsPageAdapter } from "./google-flights-page-adapter.js";
import type { ReviewedPageAdapterDefinition } from "./reviewed-page-adapter.js";

// Reviewed site adapters are static extension dependencies. A future pack may be
// added only together with its validated bundled pack definition.
export const BUNDLED_PAGE_ADAPTERS: readonly ReviewedPageAdapterDefinition[] =
  Object.freeze([
    Object.freeze({
      pack: googleFlightsPack,
      tools: GOOGLE_FLIGHTS_TOOLS,
      create: createGoogleFlightsPageAdapter,
    }),
  ]);
