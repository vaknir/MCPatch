import {
  Ajv2020,
  type AnySchema,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import addFormatsModule, { type FormatsPlugin } from "ajv-formats";

import type {
  PackManifest,
  PackPermission,
  PackToolManifest,
} from "./types.js";
import { compareStableVersions } from "./validation/primitives.js";

const addFormats = addFormatsModule as unknown as FormatsPlugin;

export interface ToolSchemaValidators {
  readonly input: ValidateFunction;
  readonly output: ValidateFunction;
}

export function runtimeIsCompatible(
  manifest: PackManifest,
  runtimeVersion: string,
): boolean {
  return (
    compareStableVersions(
      runtimeVersion,
      manifest.compatibility.runtime.minimum,
    ) >= 0 &&
    compareStableVersions(
      runtimeVersion,
      manifest.compatibility.runtime.maximumExclusive,
    ) < 0
  );
}

export function bridgeProtocolIsCompatible(
  manifest: PackManifest,
  version: number,
): boolean {
  const range = manifest.compatibility.bridgeProtocol;
  return version >= range.minimum && version <= range.maximum;
}

export function permissionsAreAllowed(
  manifest: PackManifest,
  allowedPermissions: readonly PackPermission[],
): boolean {
  const allowed = new Set(allowedPermissions);
  return manifest.tools.every((tool) =>
    tool.permissions.every((permission) => allowed.has(permission)),
  );
}

export function compileToolSchemas(tools: readonly PackToolManifest[]): {
  readonly validators: ReadonlyMap<string, ToolSchemaValidators>;
  readonly invalidTools: ReadonlySet<string>;
} {
  const validators = new Map<string, ToolSchemaValidators>();
  const invalidTools = new Set<string>();
  for (const tool of tools) {
    try {
      const ajv = new Ajv2020({
        allErrors: false,
        strict: true,
        validateFormats: true,
      });
      addFormats(ajv);
      const input = ajv.compile(tool.inputSchema as AnySchema);
      const output = ajv.compile(tool.outputSchema as AnySchema);
      if (isAsyncValidator(input) || isAsyncValidator(output)) {
        invalidTools.add(tool.name);
        continue;
      }
      validators.set(tool.name, {
        input: input as ValidateFunction,
        output: output as ValidateFunction,
      });
    } catch {
      invalidTools.add(tool.name);
    }
  }
  return { validators, invalidTools };
}

function isAsyncValidator(value: object): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(value, "$async");
  return (
    descriptor !== undefined &&
    "value" in descriptor &&
    descriptor.value === true
  );
}
