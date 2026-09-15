import {
  type JsonObject as PackJsonObject,
  type ResolvedCapability,
} from "@mcpatch/sdk/runtime";
import {
  PROTOCOL_VERSION,
  type Capability,
  type ContextClosed,
  type ContextClosedReason,
  type JsonObject,
} from "@mcpatch/protocol";

import type {
  ActiveContext,
  NativeRuntimeTool,
  RuntimeRoute,
} from "./compiled-pack-model.js";
import type {
  ValidatedCompiledPack,
  ValidatedCompiledPackRuntimeOptions,
} from "./compiled-pack-validation.js";
import { supportsRuntimeSchema } from "./runtime-schema.js";

export function validateNativeTools(
  tools: readonly NativeRuntimeTool[],
  options: ValidatedCompiledPackRuntimeOptions,
): readonly NativeRuntimeTool[] | undefined {
  if (!Array.isArray(tools) || tools.length > 256) return undefined;
  const allowed = new Set<string>(options.allowedPermissions);
  const validated: NativeRuntimeTool[] = [];
  for (const candidate of tools) {
    const fields = nativeFields(candidate);
    if (
      fields === undefined ||
      typeof fields.execute !== "function" ||
      !isDataRecord(fields.tool) ||
      !Array.isArray(fields.tool.permissions) ||
      !fields.tool.permissions.every(
        (permission: unknown) =>
          typeof permission === "string" && allowed.has(permission),
      ) ||
      !isDataRecord(fields.tool.inputSchema) ||
      !isDataRecord(fields.tool.outputSchema) ||
      !supportsRuntimeSchema(fields.tool.inputSchema as PackJsonObject) ||
      !supportsRuntimeSchema(fields.tool.outputSchema as PackJsonObject)
    ) {
      return undefined;
    }
    try {
      validated.push(
        Object.freeze({
          tool: structuredClone(
            fields.tool,
          ) as unknown as NativeRuntimeTool["tool"],
          execute: fields.execute as NativeRuntimeTool["execute"],
        }),
      );
    } catch {
      return undefined;
    }
  }
  return Object.freeze(validated);
}

function nativeFields(
  value: unknown,
): { readonly tool: unknown; readonly execute: unknown } | undefined {
  if (!isDataRecord(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 2 ||
    !keys.includes("tool") ||
    !keys.includes("execute")
  ) {
    return undefined;
  }
  return { tool: value.tool, execute: value.execute };
}

function isDataRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && "value" in descriptor;
  });
}

export function createRoutes(
  capabilities: readonly ResolvedCapability<
    NativeRuntimeTool,
    ValidatedCompiledPack
  >[],
): ReadonlyMap<string, RuntimeRoute> {
  const routes = new Map<string, RuntimeRoute>();
  for (const capability of capabilities) {
    const tool =
      capability.source === "pack" ? capability.tool : capability.value.tool;
    const execute =
      capability.source === "pack"
        ? capability.value.handlers[capability.name]
        : capability.value.execute;
    if (execute === undefined)
      throw new Error("resolved handler invariant failed");
    routes.set(
      capability.name,
      Object.freeze({
        execute,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      }),
    );
  }
  return routes;
}

export function toProtocolCapability(
  capability: ResolvedCapability<NativeRuntimeTool, ValidatedCompiledPack>,
): Capability {
  const tool =
    capability.source === "pack" ? capability.tool : capability.value.tool;
  const base = {
    name: capability.name,
    ...(tool.title === undefined ? {} : { title: tool.title }),
    description: tool.description,
    origin: capability.binding.origin,
    risk: tool.risk,
    permissions: [...tool.permissions],
    inputSchema: structuredClone(tool.inputSchema) as JsonObject,
    outputSchema: structuredClone(tool.outputSchema) as JsonObject,
  };
  return capability.source === "pack"
    ? { ...base, source: "pack", pack: capability.pack }
    : { ...base, source: "native_webmcp" };
}

export function contextClosed(
  context: ActiveContext,
  reason: ContextClosedReason,
): ContextClosed {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "context_closed",
    contextId: context.contextId,
    contextRevision: context.contextRevision,
    reason,
  };
}
