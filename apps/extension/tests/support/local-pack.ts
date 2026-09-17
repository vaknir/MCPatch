import { readFileSync } from "node:fs";

import {
  computeDeclarativePackBundleDigest,
  parseDeclarativePackBundleContent,
  type DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

export const LOCAL_ORIGIN = "https://example.com";
export const LOCAL_URL = `${LOCAL_ORIGIN}/items/current`;
export const LOCAL_TOOL = "example.items.current";

export async function localBundle(
  mutate?: (value: Record<string, unknown>) => void,
): Promise<DeclarativePackBundleContent> {
  const signed = JSON.parse(
    readFileSync(
      new URL(
        "../../../../packages/sdk/fixtures/v1/bundles/valid/declarative-read.mcpack",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as Record<string, unknown>;
  Reflect.deleteProperty(signed, "publisherSignature");
  Reflect.deleteProperty(signed, "registryAttestation");
  const manifest = signed["manifest"] as Record<string, unknown>;
  manifest["compatibility"] = {
    runtime: { minimum: "0.1.0", maximumExclusive: "0.2.0" },
    bridgeProtocol: { minimum: 2, maximum: 2 },
  };
  manifest["digest"] = `sha256:${"0".repeat(64)}`;
  mutate?.(signed);
  const provisional = parseDeclarativePackBundleContent(signed);
  manifest["digest"] = await computeDeclarativePackBundleDigest(provisional);
  return parseDeclarativePackBundleContent(signed);
}

export function bundleBase64(bundle: DeclarativePackBundleContent): string {
  return Buffer.from(JSON.stringify(bundle), "utf8").toString("base64");
}
