import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  parseDeclarativePackBundleBytes,
  DeclarativePackBundleValidationError,
  verifyDeclarativePackBundle,
} from "../src/index.js";

const root = fileURLToPath(new URL("../fixtures/v1/bundles", import.meta.url));

describe("Declarative Pack Bundle v1 golden files", () => {
  it.each(readdirSync(join(root, "valid")))(
    "accepts valid %s as one JSON document",
    async (name) => {
      const bundle = parseDeclarativePackBundleBytes(
        readFileSync(join(root, "valid", name)),
      );
      expect(bundle.bundleVersion).toBe(1);
      expect(bundle.manifest.execution.kind).toBe("declarative");
      await expect(
        verifyDeclarativePackBundle(bundle, {
          trustedPublicKey: "11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo",
        }),
      ).resolves.toMatchObject({ ok: true });
    },
  );

  it.each(readdirSync(join(root, "invalid")))(
    "rejects invalid %s with a stable payload-safe error",
    (name) => {
      expect(() =>
        parseDeclarativePackBundleBytes(
          readFileSync(join(root, "invalid", name)),
        ),
      ).toThrow(DeclarativePackBundleValidationError);
      expect(() =>
        parseDeclarativePackBundleBytes(
          readFileSync(join(root, "invalid", name)),
        ),
      ).not.toThrow(/private-marker|fixture-item/);
    },
  );
});
