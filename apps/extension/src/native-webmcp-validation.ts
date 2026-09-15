import type { JsonObject } from "@mcpatch/protocol";

import {
  encodePageToWorkerMessage,
  PAGE_PROTOCOL_VERSION,
  parsePageToWorkerFrame,
  type PageNativeCapability,
} from "./page-channel.js";
import type { DraftRegisteredTool } from "./native-webmcp-model.js";

const TOOL_FIELDS = [
  "name",
  "title",
  "description",
  "inputSchema",
  "window",
  "origin",
  "annotations",
] as const;
const REQUIRED_TOOL_FIELDS = new Set([
  "name",
  "description",
  "inputSchema",
  "window",
  "origin",
  "annotations",
]);
const ANNOTATION_FIELDS = [
  "readOnlyHint",
  "consequentialHint",
  "untrustedContentHint",
] as const;

export interface ValidatedNativeTool {
  readonly capability: PageNativeCapability;
  readonly handle: DraftRegisteredTool;
}

export function validateNativeTool(
  value: unknown,
  expectedOrigin: string,
): ValidatedNativeTool | undefined {
  try {
    return validateNativeToolData(value, expectedOrigin);
  } catch {
    return undefined;
  }
}

function validateNativeToolData(
  value: unknown,
  expectedOrigin: string,
): ValidatedNativeTool | undefined {
  const tool = exactDataObject(value, TOOL_FIELDS, REQUIRED_TOOL_FIELDS);
  if (
    tool === undefined ||
    typeof tool.name !== "string" ||
    typeof tool.description !== "string" ||
    typeof tool.origin !== "string" ||
    tool.origin !== expectedOrigin ||
    (Object.hasOwn(tool, "title") && typeof tool.title !== "string") ||
    !isObjectSchema(tool.inputSchema) ||
    !readOnlyAnnotations(tool.annotations)
  ) {
    return undefined;
  }
  const title = typeof tool.title === "string" ? tool.title : undefined;
  const capability: PageNativeCapability = {
    source: "native_webmcp",
    name: tool.name,
    ...(title === "" || title === undefined ? {} : { title }),
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: {
      readOnlyHint: true,
      consequentialHint: false,
      untrustedContentHint: true,
    },
  };
  const accepted = sanitizeCapability(capability, expectedOrigin);
  return accepted === undefined
    ? undefined
    : Object.freeze({
        capability: accepted,
        handle: value as DraftRegisteredTool,
      });
}

function sanitizeCapability(
  capability: PageNativeCapability,
  origin: string,
): PageNativeCapability | undefined {
  try {
    const frame = encodePageToWorkerMessage({
      pageProtocolVersion: PAGE_PROTOCOL_VERSION,
      type: "page_capability_snapshot",
      channelId: "native.validation",
      contextId: "native.validation",
      contextRevision: 1,
      tabId: 0,
      documentId: "native.validation",
      origin,
      snapshotRevision: 1,
      capabilities: [capability],
    });
    const parsed = parsePageToWorkerFrame(frame);
    if (parsed.type !== "page_capability_snapshot") return undefined;
    const accepted = parsed.capabilities[0];
    return accepted?.source === "native_webmcp" ? accepted : undefined;
  } catch {
    return undefined;
  }
}

function isObjectSchema(value: unknown): value is JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const type = Object.getOwnPropertyDescriptor(value, "type");
  return type !== undefined && "value" in type && type.value === "object";
}

function readOnlyAnnotations(value: unknown): boolean {
  const annotations = exactDataObject(
    value,
    ANNOTATION_FIELDS,
    new Set(ANNOTATION_FIELDS),
  );
  return (
    annotations?.readOnlyHint === true &&
    annotations.consequentialHint === false &&
    annotations.untrustedContentHint === true
  );
}

function exactDataObject(
  value: unknown,
  allowedFields: readonly PropertyKey[],
  requiredFields: ReadonlySet<string>,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.some(
      (key) => typeof key !== "string" || !allowedFields.includes(key),
    ) ||
    [...requiredFields].some((field) => !keys.includes(field))
  ) {
    return undefined;
  }
  const result = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    result[key] = descriptor.value;
  }
  return result;
}
