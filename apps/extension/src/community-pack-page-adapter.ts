import type {
  ChromePageClientRuntimeApi,
  PageAdapter,
} from "./page-content-model.js";
import { loadDeclarativePackPageAdapter } from "./local-pack-page-adapter.js";

const COMMUNITY_INSTALL_ID = /^registry\.[a-f0-9]{32}$/u;

export function loadCommunityPackPageAdapter(
  runtime: ChromePageClientRuntimeApi,
  document: Document,
  location: Location,
): Promise<PageAdapter> {
  return loadDeclarativePackPageAdapter(runtime, document, location, {
    contextPrefix: "registry",
    installId: COMMUNITY_INSTALL_ID,
    maximumPacks: 4,
    requestType: "community_pack_content_config",
    trust: new Set(["OFFICIAL", "REVIEWED_COMMUNITY"]),
  });
}
