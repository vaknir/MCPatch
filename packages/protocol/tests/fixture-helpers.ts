import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const schemaDirectory = fileURLToPath(
  new URL("../schema/v1/", import.meta.url),
);
export const validDirectory = fileURLToPath(
  new URL("../fixtures/v1/valid/", import.meta.url),
);
export const invalidDirectory = fileURLToPath(
  new URL("../fixtures/v1/invalid/", import.meta.url),
);

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

export function readFixture(directory: string, name: string): unknown {
  return readJson(join(directory, name));
}

export function fixtureNames(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort();
}
