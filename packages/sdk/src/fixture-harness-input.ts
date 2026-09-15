import type { PackToolHandler } from "./authoring.js";
import type {
  PackFixtureVerificationOptions,
  PackFixtureVerificationSubject,
  PackVerificationIssue,
} from "./fixture-harness-types.js";
import type { PackManifest, PackPermission } from "./types.js";
import { validatePackManifest } from "./validation/manifest.js";
import {
  boundedInteger,
  cloneAndFreeze,
  isRecord,
  validateJsonBounds,
} from "./validation/primitives.js";

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const PERMISSIONS = new Set<PackPermission>([
  "ACTION",
  "ARBITRARY_EXECUTION",
  "CREDENTIAL",
  "EXTERNAL_NETWORK",
  "READ",
  "SENSITIVE",
]);

export interface ValidatedVerificationOptions {
  readonly runtimeVersion: string;
  readonly bridgeProtocolVersion: number;
  readonly allowedPermissions: readonly PackPermission[];
  readonly timeoutMs: number;
}

export function validateSubject(value: PackFixtureVerificationSubject):
  | {
      manifest: PackManifest;
      handlers: Readonly<Record<string, PackToolHandler>>;
    }
  | { issue: PackVerificationIssue } {
  const subject = closedDataObject(value, ["manifest", "handlers"]);
  if (subject === undefined) {
    return { issue: { code: "INVALID_SUBJECT", field: "$" } };
  }
  const manifestIssue = validatePackManifest(subject.manifest);
  if (manifestIssue !== undefined) {
    return {
      issue: {
        code: "INVALID_MANIFEST",
        field: manifestIssue.field,
        manifestCode: manifestIssue.code,
      },
    };
  }
  const manifest = cloneAndFreeze(subject.manifest) as PackManifest;
  const handlers = validateHandlers(subject.handlers, manifest);
  if ("issue" in handlers) return handlers;
  return { manifest, handlers: handlers.value };
}

export function validateOptions(
  value: PackFixtureVerificationOptions,
): ValidatedVerificationOptions | { issue: PackVerificationIssue } {
  if (validateJsonBounds(value) !== undefined) {
    return { issue: { code: "INVALID_OPTIONS", field: "options" } };
  }
  const options = closedDataObject(
    value,
    ["runtimeVersion", "bridgeProtocolVersion", "allowedPermissions"],
    ["timeoutMs"],
  );
  if (options === undefined) {
    return { issue: { code: "INVALID_OPTIONS", field: "options" } };
  }
  if (
    typeof options.runtimeVersion !== "string" ||
    !STABLE_SEMVER.test(options.runtimeVersion)
  ) {
    return {
      issue: { code: "INVALID_OPTIONS", field: "options.runtimeVersion" },
    };
  }
  if (!boundedInteger(options.bridgeProtocolVersion, 1, 65_535)) {
    return {
      issue: {
        code: "INVALID_OPTIONS",
        field: "options.bridgeProtocolVersion",
      },
    };
  }
  const allowedPermissions = validateAllowedPermissions(
    options.allowedPermissions,
  );
  if (allowedPermissions === undefined) {
    return {
      issue: {
        code: "INVALID_OPTIONS",
        field: "options.allowedPermissions",
      },
    };
  }
  const timeoutMs = options.timeoutMs ?? 1_000;
  if (!boundedInteger(timeoutMs, 1, 10_000)) {
    return {
      issue: { code: "INVALID_OPTIONS", field: "options.timeoutMs" },
    };
  }
  return Object.freeze({
    runtimeVersion: options.runtimeVersion,
    bridgeProtocolVersion: options.bridgeProtocolVersion as number,
    allowedPermissions: Object.freeze(allowedPermissions),
    timeoutMs: timeoutMs as number,
  });
}

function validateHandlers(
  value: unknown,
  manifest: PackManifest,
):
  | { value: Readonly<Record<string, PackToolHandler>> }
  | { issue: PackVerificationIssue } {
  if (!isRecord(value)) {
    return {
      issue: { code: "INVALID_HANDLER_TABLE", field: "handlers" },
    };
  }
  const names = new Set(manifest.tools.map((tool) => tool.name));
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !names.has(key)) {
      return {
        issue: { code: "INVALID_HANDLER_TABLE", field: "handlers" },
      };
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      return {
        issue: { code: "INVALID_HANDLER_TABLE", field: "handlers" },
      };
    }
  }
  const handlers = Object.create(null) as Record<string, PackToolHandler>;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      typeof descriptor.value !== "function"
    ) {
      return {
        issue: {
          code: "INVALID_HANDLER_TABLE",
          field: `handlers.${name}`,
        },
      };
    }
    Object.defineProperty(handlers, name, {
      configurable: false,
      enumerable: true,
      value: descriptor.value as PackToolHandler,
      writable: false,
    });
  }
  return { value: Object.freeze(handlers) };
}

function validateAllowedPermissions(
  value: unknown,
): PackPermission[] | undefined {
  if (!Array.isArray(value) || value.length > PERMISSIONS.size)
    return undefined;
  const permissions: PackPermission[] = [];
  for (const permission of value as unknown[]) {
    if (
      typeof permission !== "string" ||
      !PERMISSIONS.has(permission as PackPermission)
    ) {
      return undefined;
    }
    permissions.push(permission as PackPermission);
  }
  if (new Set(permissions).size !== permissions.length) return undefined;
  return permissions.sort();
}

function closedDataObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const allowed = new Set([...required, ...optional]);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowed.has(key)) return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
  }
  const output: Record<string, unknown> = {};
  for (const key of required) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) return undefined;
    output[key] = descriptor.value;
  }
  for (const key of optional) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor)) return undefined;
      output[key] = descriptor.value;
    }
  }
  return output;
}
