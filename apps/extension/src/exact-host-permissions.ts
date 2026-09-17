import type { ChromePermissionsApi } from "./enablement-model.js";

/**
 * Proves that every required exact HTTPS pattern exists in Chromium's complete
 * permission inventory. A wildcard or all-URLs grant is never accepted as a
 * substitute, even when Chromium's `contains()` would report success.
 */
export async function hasExactHostPermissions(
  permissions: ChromePermissionsApi,
  required: readonly string[],
): Promise<boolean> {
  if (
    required.length === 0 ||
    new Set(required).size !== required.length ||
    required.some((pattern) => !isExactHttpsPattern(pattern))
  ) {
    return false;
  }
  let inventory;
  try {
    inventory = await permissions.getAll();
  } catch {
    return false;
  }
  if (!Array.isArray(inventory.origins)) return false;
  const origins = new Set<string>();
  for (const value of inventory.origins) {
    if (typeof value !== "string") return false;
    origins.add(value);
  }
  return required.every((pattern) => origins.has(pattern));
}

export function isExactHttpsPattern(value: string): boolean {
  if (
    !value.endsWith("/*") ||
    value.slice(0, -1).includes("*") ||
    value.includes("*.") ||
    value === "<all_urls>"
  ) {
    return false;
  }
  try {
    const origin = value.slice(0, -2);
    const parsed = new URL(origin);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      !parsed.hostname.includes("*") &&
      parsed.origin === origin &&
      `${parsed.origin}/*` === value
    );
  } catch {
    return false;
  }
}
