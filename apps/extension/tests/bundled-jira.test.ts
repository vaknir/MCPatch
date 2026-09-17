import {
  JIRA_ORIGIN_PLACEHOLDER,
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

const CONFIGURED_ORIGIN = "https://jira.corp.example.com";

function catalog(configured: readonly { origin: string }[] = []) {
  return createReviewedPackCatalog(
    BUNDLED_PACKS,
    PACK_RUNTIME_OPTIONS,
    DECLARED_OPTIONAL_ORIGINS,
    configured.map((site) => ({
      publisher: jiraPack.manifest.publisher,
      id: jiraPack.manifest.id,
      origin: site.origin,
    })),
  );
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

  it("contributes no site until the user configures an origin", () => {
    const sites = catalog().sites.filter(
      (site) => site.manifest.id === jiraPack.manifest.id,
    );

    expect(sites).toEqual([]);
    expect(DECLARED_OPTIONAL_ORIGINS).not.toContain(JIRA_ORIGIN_PLACEHOLDER);
    expect(catalog().match(`${JIRA_ORIGIN_PLACEHOLDER}/browse/ABC-1`)).toEqual(
      [],
    );
  });

  it("binds the configured origin to the reviewed manifest identity", () => {
    const configured = catalog([{ origin: CONFIGURED_ORIGIN }]);
    const matched = configured.match(`${CONFIGURED_ORIGIN}/browse/ABC-1`);

    expect(matched).toHaveLength(1);
    const site = matched[0];
    expect(site?.origin).toBe(CONFIGURED_ORIGIN);
    expect(site?.permissionPatterns).toEqual([`${CONFIGURED_ORIGIN}/*`]);
    expect(site?.manifest.digest).toBe(jiraPack.manifest.digest);
    expect(site?.manifest.matches).toEqual([
      { origin: CONFIGURED_ORIGIN, paths: [{ kind: "prefix", path: "/" }] },
    ]);
  });

  it("never matches an origin the user did not configure", () => {
    const configured = catalog([{ origin: CONFIGURED_ORIGIN }]);

    expect(
      configured.match("https://jira.other.example.com/browse/ABC-1"),
    ).toEqual([]);
    expect(configured.match(`${JIRA_ORIGIN_PLACEHOLDER}/browse/ABC-1`)).toEqual(
      [],
    );
  });

  it("serves several configured deployments at once", () => {
    const second = "https://jira.eu.example.com";
    const configured = catalog([
      { origin: CONFIGURED_ORIGIN },
      { origin: second },
    ]);

    expect(
      configured.match(`${CONFIGURED_ORIGIN}/secure/Dashboard.jspa`),
    ).toHaveLength(1);
    expect(configured.match(`${second}/secure/Dashboard.jspa`)).toHaveLength(1);
  });

  it("declares the broad optional pattern that expresses a self-hosted origin", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../manifest.json", import.meta.url), "utf8"),
    ) as Record<string, unknown>;

    expect(manifest["optional_host_permissions"]).toContain("https://*/*");
    expect(manifest).not.toHaveProperty("host_permissions");
  });

  it("asks for no extension network authority", () => {
    expect(jiraPack.manifest.networkPolicy).toEqual({
      extensionRequests: "none",
    });
  });
});
