import {
  JIRA_ENABLEABLE_ORIGINS,
  JIRA_SITE_ORIGINS,
  JIRA_TOOLS,
  jiraBrowserPack,
  jiraPack,
} from "@mcpatch/jira-pack";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { BUNDLED_PAGE_ADAPTERS } from "../src/bundled-page-adapters.js";
import {
  BUNDLED_PACKS,
  DECLARED_OPTIONAL_ORIGINS,
  PACK_RUNTIME_OPTIONS,
} from "../src/bundled-packs.js";
import { createReviewedPackCatalog } from "../src/reviewed-pack-catalog.js";

function optionalHostPermissions(): readonly string[] {
  const manifest = JSON.parse(
    readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
  ) as Record<string, unknown>;
  return manifest["optional_host_permissions"] as readonly string[];
}

describe("bundled Jira Data Center pack", () => {
  it("uses the generated page definition without extension-local wiring", () => {
    const definition = BUNDLED_PAGE_ADAPTERS.find(
      (candidate) => candidate.pack === jiraPack,
    );

    expect(definition).toBe(jiraBrowserPack.page);
    expect([...(definition?.tools ?? [])].sort()).toEqual(
      [...JIRA_TOOLS].sort(),
    );
    expect(BUNDLED_PACKS).toContain(jiraPack);
  });

  it("grants no browser authority while the deployment list is synthetic", () => {
    const catalog = createReviewedPackCatalog(
      BUNDLED_PACKS,
      PACK_RUNTIME_OPTIONS,
      DECLARED_OPTIONAL_ORIGINS,
    );

    expect(JIRA_ENABLEABLE_ORIGINS).toEqual([]);
    for (const origin of JIRA_SITE_ORIGINS) {
      expect(DECLARED_OPTIONAL_ORIGINS).not.toContain(origin);
      expect(catalog.match(`${origin}/browse/ABC-1`)).toEqual([]);
    }
  });

  it("keeps every enableable Jira origin mirrored by the extension manifest", () => {
    const declared = optionalHostPermissions();

    for (const origin of JIRA_ENABLEABLE_ORIGINS) {
      expect(DECLARED_OPTIONAL_ORIGINS).toContain(origin);
      expect(declared).toContain(`${origin}/*`);
    }
  });

  it("asks for no extension network authority", () => {
    expect(jiraPack.manifest.networkPolicy).toEqual({
      extensionRequests: "none",
    });
  });
});
