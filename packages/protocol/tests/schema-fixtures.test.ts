import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";
import { describe, expect, it } from "vitest";

const addFormats = addFormatsModule as unknown as FormatsPlugin;

const schemaDirectory = fileURLToPath(
  new URL("../schema/v1/", import.meta.url),
);
const validDirectory = fileURLToPath(
  new URL("../fixtures/v1/valid/", import.meta.url),
);
const invalidDirectory = fileURLToPath(
  new URL("../fixtures/v1/invalid/", import.meta.url),
);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function fixtureNames(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function messageType(value: unknown): string | undefined {
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string"
  ) {
    return value.type;
  }

  return undefined;
}

function createValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv);

  const schemaNames = fixtureNames(schemaDirectory);
  for (const name of schemaNames) {
    if (name !== "message.schema.json") {
      ajv.addSchema(readJson(join(schemaDirectory, name)) as AnySchema);
    }
  }

  return ajv.compile(
    readJson(join(schemaDirectory, "message.schema.json")) as AnySchema,
  );
}

const validate = createValidator();
const validFixtures = fixtureNames(validDirectory);
const invalidFixtures = fixtureNames(invalidDirectory);

describe("protocol v1 golden fixtures", () => {
  it("contains both accepted and rejected cases", () => {
    expect(validFixtures.length).toBeGreaterThan(0);
    expect(invalidFixtures.length).toBeGreaterThan(0);
  });

  it("covers every message discriminator with an accepted fixture", () => {
    const coveredTypes = validFixtures
      .map((name) => messageType(readJson(join(validDirectory, name))))
      .filter((type): type is string => type !== undefined)
      .sort();

    expect(coveredTypes).toEqual([
      "approval_required",
      "approval_result",
      "cancel",
      "capability_snapshot",
      "connection_error",
      "context_closed",
      "heartbeat",
      "hello",
      "hello_ack",
      "tool_call",
      "tool_error",
      "tool_result",
    ]);
  });

  it.each(validFixtures)("accepts %s", (name) => {
    const valid = validate(readJson(join(validDirectory, name)));
    expect(valid, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });

  it.each(invalidFixtures)("rejects %s", (name) => {
    const valid = validate(readJson(join(invalidDirectory, name)));
    expect(valid, `${name} unexpectedly matched protocol v1`).toBe(false);
  });
});
