import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { jiraPack } from "../src/index.js";

describe("Jira pack identity", () => {
  it("records the digest of its own reviewed manifest", () => {
    expect(jiraPack.manifest.digest).toBe(manifestDigest());
  });
});

/** The digest covers the manifest with its own digest field removed. */
function manifestDigest(): string {
  const content: Record<string, unknown> = { ...jiraPack.manifest };
  delete content["digest"];
  const hash = createHash("sha256").update(stableStringify(content), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => (left < right ? -1 : 1),
    );
    const fields = entries.map(
      ([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`,
    );
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
