import {
  boundedText,
  exact,
  invalidType,
  invalidValue,
  isRecord,
  toolName,
} from "./page-channel-primitives.js";
import {
  MAX_PAGE_CAPABILITIES,
  PageProtocolValidationError,
  type PageCapability,
} from "./page-channel-types.js";

export function validateCapabilities(value: unknown): void {
  if (!Array.isArray(value)) invalidType("capabilities");
  if (value.length > MAX_PAGE_CAPABILITIES) {
    throw new PageProtocolValidationError("LIMIT_EXCEEDED", "capabilities");
  }
  const identities = new Set<string>();
  for (const [index, capability] of value.entries()) {
    const checked = validateCapability(capability, `capabilities[${index}]`);
    const identity = `${checked.source}:${checked.name}`;
    if (identities.has(identity)) invalidValue(`capabilities[${index}].name`);
    identities.add(identity);
  }
}

function validateCapability(value: unknown, field: string): PageCapability {
  if (!isRecord(value)) invalidType(field);
  if (value.source === "pack") {
    exact(value, ["source", "name"], [], field);
    toolName(value.name, `${field}.name`);
    return value as unknown as PageCapability;
  }
  if (value.source !== "native_webmcp") invalidValue(`${field}.source`);
  exact(
    value,
    ["source", "name", "description", "inputSchema", "annotations"],
    ["title"],
    field,
  );
  toolName(value.name, `${field}.name`);
  boundedText(value.description, 1, 4_096, `${field}.description`);
  if (Object.hasOwn(value, "title")) {
    boundedText(value.title, 1, 256, `${field}.title`);
  }
  if (!isRecord(value.inputSchema)) invalidType(`${field}.inputSchema`);
  validateNativeAnnotations(value.annotations, field);
  return value as unknown as PageCapability;
}

function validateNativeAnnotations(value: unknown, field: string): void {
  if (!isRecord(value)) invalidType(`${field}.annotations`);
  exact(
    value,
    ["readOnlyHint", "consequentialHint", "untrustedContentHint"],
    [],
    `${field}.annotations`,
  );
  if (
    value.readOnlyHint !== true ||
    value.consequentialHint !== false ||
    value.untrustedContentHint !== true
  ) {
    invalidValue(`${field}.annotations`);
  }
}
