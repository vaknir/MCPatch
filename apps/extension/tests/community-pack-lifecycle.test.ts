import { describe, expect, it } from "vitest";

import {
  compareCommunityVersions,
  latestCommunityEntry,
} from "../src/community-pack-lifecycle.js";
import type { CommunityRegistryPackEntry } from "@mcpatch/sdk/runtime";

describe("community pack lifecycle", () => {
  it.each([
    ["1.0.0", "0.9.9", 1],
    ["1.0.0", "1.0.0", 0],
    ["1.0.0-alpha", "1.0.0", -1],
    ["1.0.0-alpha.2", "1.0.0-alpha.10", -1],
    ["1.0.0-beta", "1.0.0-alpha", 1],
    ["1.0.0+build.2", "1.0.0+build.1", 0],
  ])("compares %s and %s by SemVer precedence", (left, right, expected) => {
    expect(compareCommunityVersions(left, right)).toBe(expected);
  });

  it("selects the newest bounded registry version independently of lexical order", () => {
    const entries = ["1.9.0", "1.10.0", "2.0.0-rc.1"].map(
      (version) => ({ version }) as CommunityRegistryPackEntry,
    );
    expect(latestCommunityEntry(entries)?.version).toBe("2.0.0-rc.1");
  });
});
