import type { PackManifestValidationIssue } from "../types.js";
import { boundedArray, closedObject, isAscii, issue } from "./primitives.js";

export function validateMatches(
  value: unknown,
): PackManifestValidationIssue | undefined {
  if (!boundedArray(value, 1, 32)) return issue("LIMIT_EXCEEDED", "matches");
  const origins = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const prefix = `matches[${index}]`;
    const checked = closedObject(candidate, ["origin", "paths"], [], prefix);
    if (checked.issue !== undefined) return checked.issue;
    const originIssue = validateOrigin(
      checked.value.origin,
      `${prefix}.origin`,
    );
    if (originIssue !== undefined) return originIssue;
    if (origins.has(checked.value.origin as string)) {
      return issue("DUPLICATE_VALUE", `${prefix}.origin`);
    }
    origins.add(checked.value.origin as string);
    if (!boundedArray(checked.value.paths, 1, 32)) {
      return issue("LIMIT_EXCEEDED", `${prefix}.paths`);
    }
    const paths = new Set<string>();
    for (const [pathIndex, pathCandidate] of checked.value.paths.entries()) {
      const pathPrefix = `${prefix}.paths[${pathIndex}]`;
      const path = closedObject(
        pathCandidate,
        ["kind", "path"],
        [],
        pathPrefix,
      );
      if (path.issue !== undefined) return path.issue;
      if (path.value.kind !== "exact" && path.value.kind !== "prefix") {
        return issue("INVALID_VALUE", `${pathPrefix}.kind`);
      }
      const pathIssue = validatePath(
        path.value.path,
        path.value.kind,
        `${pathPrefix}.path`,
      );
      if (pathIssue !== undefined) return pathIssue;
      const key = `${path.value.kind}:${String(path.value.path)}`;
      if (paths.has(key)) return issue("DUPLICATE_VALUE", `${pathPrefix}.path`);
      paths.add(key);
    }
  }
  return undefined;
}

export function validateNetworkPolicy(
  value: unknown,
): PackManifestValidationIssue | undefined {
  const checked = closedObject(
    value,
    ["extensionRequests"],
    [],
    "networkPolicy",
  );
  if (checked.issue !== undefined) return checked.issue;
  const requests = checked.value.extensionRequests;
  if (requests === "none") return undefined;
  const requestPolicy = closedObject(
    requests,
    ["origins", "methods"],
    [],
    "networkPolicy.extensionRequests",
  );
  if (requestPolicy.issue !== undefined) return requestPolicy.issue;
  if (!boundedArray(requestPolicy.value.origins, 1, 8)) {
    return issue("LIMIT_EXCEEDED", "networkPolicy.extensionRequests.origins");
  }
  const origins = new Set<string>();
  for (const [index, origin] of requestPolicy.value.origins.entries()) {
    const originIssue = validateOrigin(
      origin,
      `networkPolicy.extensionRequests.origins[${index}]`,
    );
    if (originIssue !== undefined) return originIssue;
    if (origins.has(origin as string)) {
      return issue(
        "DUPLICATE_VALUE",
        `networkPolicy.extensionRequests.origins[${index}]`,
      );
    }
    origins.add(origin as string);
  }
  return Array.isArray(requestPolicy.value.methods) &&
    requestPolicy.value.methods.length === 1 &&
    requestPolicy.value.methods[0] === "GET"
    ? undefined
    : issue("INVALID_PERMISSION", "networkPolicy.extensionRequests.methods");
}

function validateOrigin(
  value: unknown,
  field: string,
): PackManifestValidationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length > 2048 ||
    !isAscii(value) ||
    value.includes("*")
  ) {
    return issue("INVALID_ORIGIN", field);
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      parsed.origin !== value
    ) {
      return issue("INVALID_ORIGIN", field);
    }
  } catch {
    return issue("INVALID_ORIGIN", field);
  }
  return undefined;
}

function validatePath(
  value: unknown,
  kind: unknown,
  field: string,
): PackManifestValidationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    !isAscii(value) ||
    !value.startsWith("/") ||
    value.includes("//") ||
    /[%\\?#]/.test(value) ||
    hasControlCharacter(value) ||
    (kind === "prefix" && !value.endsWith("/"))
  ) {
    return issue("INVALID_PATH", field);
  }
  try {
    if (new URL(value, "https://path.invalid").pathname !== value) {
      return issue("INVALID_PATH", field);
    }
  } catch {
    return issue("INVALID_PATH", field);
  }
  return undefined;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });
}
