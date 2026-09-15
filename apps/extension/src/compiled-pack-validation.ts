import {
  packSupportsBridgeProtocol,
  packSupportsRuntime,
  parsePackManifest,
  type PackManifest,
  type PackPermission,
  type PackToolHandler,
} from "@mcpatch/sdk/runtime";

import { supportsRuntimeSchema } from "./runtime-schema.js";

const MAX_PACKS = 64;
const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PERMISSIONS = new Set<PackPermission>([
  "ACTION",
  "ARBITRARY_EXECUTION",
  "CREDENTIAL",
  "EXTERNAL_NETWORK",
  "READ",
  "SENSITIVE",
]);

export interface CompiledPackRuntimeOptions {
  readonly runtimeVersion: string;
  readonly bridgeProtocolVersion: number;
  readonly allowedPermissions: readonly PackPermission[];
}

export interface ValidatedCompiledPackRuntimeOptions extends CompiledPackRuntimeOptions {
  readonly allowedPermissions: readonly PackPermission[];
}

export interface CompiledPackSubject {
  readonly manifest: unknown;
  readonly handlers: unknown;
}

export interface ValidatedCompiledPack {
  readonly manifest: PackManifest;
  readonly handlers: Readonly<Record<string, PackToolHandler>>;
}

export function validateCompiledPacks(
  subjects: readonly CompiledPackSubject[],
  options: ValidatedCompiledPackRuntimeOptions,
): readonly ValidatedCompiledPack[] | undefined {
  if (!Array.isArray(subjects) || subjects.length > MAX_PACKS) return undefined;
  const allowed = new Set(options.allowedPermissions);
  const identities = new Set<string>();
  const packs: ValidatedCompiledPack[] = [];
  for (const subject of subjects) {
    const pack = validateCompiledPack(subject, options, allowed);
    if (pack === undefined) return undefined;
    const identity = `${pack.manifest.publisher}/${pack.manifest.id}`;
    if (identities.has(identity)) return undefined;
    identities.add(identity);
    packs.push(pack);
  }
  return Object.freeze(packs);
}

export function validateRuntimeOptions(
  options: CompiledPackRuntimeOptions,
): ValidatedCompiledPackRuntimeOptions | undefined {
  if (
    !STABLE_SEMVER.test(options.runtimeVersion) ||
    !Number.isSafeInteger(options.bridgeProtocolVersion) ||
    options.bridgeProtocolVersion < 1 ||
    options.bridgeProtocolVersion > 65_535 ||
    !Array.isArray(options.allowedPermissions) ||
    options.allowedPermissions.length > PERMISSIONS.size ||
    options.allowedPermissions.some(
      (permission) => !PERMISSIONS.has(permission),
    ) ||
    new Set(options.allowedPermissions).size !==
      options.allowedPermissions.length
  ) {
    return undefined;
  }
  return Object.freeze({
    runtimeVersion: options.runtimeVersion,
    bridgeProtocolVersion: options.bridgeProtocolVersion,
    allowedPermissions: Object.freeze([...options.allowedPermissions].sort()),
  });
}

function validateCompiledPack(
  subject: CompiledPackSubject,
  options: ValidatedCompiledPackRuntimeOptions,
  allowed: ReadonlySet<PackPermission>,
): ValidatedCompiledPack | undefined {
  const definition = exactDataObject(subject, ["manifest", "handlers"]);
  if (definition === undefined) return undefined;
  let manifest: PackManifest;
  try {
    manifest = parsePackManifest(definition.manifest);
  } catch {
    return undefined;
  }
  if (
    manifest.execution.kind !== "bundled" ||
    !packSupportsRuntime(manifest, options.runtimeVersion) ||
    !packSupportsBridgeProtocol(manifest, options.bridgeProtocolVersion) ||
    !manifest.tools.every(
      (tool) =>
        tool.permissions.every((permission) => allowed.has(permission)) &&
        supportsRuntimeSchema(tool.inputSchema) &&
        supportsRuntimeSchema(tool.outputSchema),
    )
  ) {
    return undefined;
  }
  const handlers = validateHandlers(definition.handlers, manifest);
  return handlers === undefined
    ? undefined
    : Object.freeze({ manifest, handlers });
}

function validateHandlers(
  value: unknown,
  manifest: PackManifest,
): Readonly<Record<string, PackToolHandler>> | undefined {
  if (!isRecord(value)) return undefined;
  const names = new Set(manifest.tools.map((tool) => tool.name));
  if (
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !names.has(key),
    )
  ) {
    return undefined;
  }
  const handlers = Object.create(null) as Record<string, PackToolHandler>;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    ) {
      return undefined;
    }
    Object.defineProperty(handlers, name, {
      enumerable: true,
      value: descriptor.value as PackToolHandler,
    });
  }
  return Object.freeze(handlers);
}

function exactDataObject(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== "string" || !fields.includes(key))
  ) {
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    result[field] = descriptor.value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
