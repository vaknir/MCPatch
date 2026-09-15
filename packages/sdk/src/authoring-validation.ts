import type { PackManifestValidationIssue } from "./types.js";
import { PackManifestValidationError } from "./validation/manifest.js";
import { isRecord, issue, type RecordValue } from "./validation/primitives.js";

export function authoringObject(
  value: unknown,
  fields: readonly string[],
  optional: ReadonlySet<string>,
  field: string,
): RecordValue {
  if (!isRecord(value)) reject(issue("INVALID_TYPE", field));
  const allowed = new Set(fields);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) {
      reject(issue("UNKNOWN_FIELD", `${field}.${String(key)}`));
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      reject(issue("INVALID_TYPE", `${field}.${key}`));
    }
  }
  for (const required of fields) {
    if (!optional.has(required) && !Object.hasOwn(value, required)) {
      reject(issue("INVALID_VALUE", `${field}.${required}`));
    }
  }
  return value;
}

export function remapToolIssue(
  validationIssue: PackManifestValidationIssue,
): PackManifestValidationIssue {
  return {
    code: validationIssue.code,
    field: validationIssue.field.replace(/^(?:tools\[0\]|\$)/, "tool"),
  };
}

export function reject(validationIssue: PackManifestValidationIssue): never {
  throw new PackManifestValidationError(validationIssue);
}
