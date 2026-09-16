import { googleFlightsBrowserPack } from "@mcpatch/google-flights-pack";
import { tradingViewBrowserPack } from "@mcpatch/tradingview-pack";

import type { ReviewedPageAdapterDefinition } from "./reviewed-page-adapter.js";

// Reviewed site adapters are static extension dependencies. A future pack may be
// added only together with its validated bundled pack definition.
export const BUNDLED_PAGE_ADAPTERS: readonly ReviewedPageAdapterDefinition[] =
  Object.freeze([googleFlightsBrowserPack.page, tradingViewBrowserPack.page]);
