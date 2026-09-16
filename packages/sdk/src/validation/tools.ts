import type { PackManifestValidationIssue } from "../types.js";
import { closedSchemaIssue } from "./closed-schema.js";
import {
  type RecordValue,
  boundedArray,
  boundedPattern,
  boundedText,
  closedObject,
  isRecord,
  issue,
  validPattern,
} from "./primitives.js";

const TOOL_NAME = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const FIXTURE_ID = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/;
const PERMISSIONS = new Set([
  "READ",
  "ACTION",
  "SENSITIVE",
  "CREDENTIAL",
  "EXTERNAL_NETWORK",
  "ARBITRARY_EXECUTION",
]);
const FIXTURE_ERROR_CODES = new Set([
  "INVALID_REQUEST",
  "CAPABILITY_DENIED",
  "ORIGIN_MISMATCH",
  "CONTEXT_NOT_FOUND",
  "TOOL_NOT_FOUND",
  "APPROVAL_REQUIRED",
  "APPROVAL_DENIED",
  "CANCELLED",
  "TIMEOUT",
  "EXECUTION_FAILED",
  "RESULT_INVALID",
  "INTERNAL_ERROR",
]);

export function validateTools(
  value: unknown,
  publisher: string,
): { names: Set<string> } | { issue: PackManifestValidationIssue } {
  if (!boundedArray(value, 1, 128)) {
    return { issue: issue("LIMIT_EXCEEDED", "tools") };
  }
  const names = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const prefix = `tools[${index}]`;
    const checked = closedObject(
      candidate,
      [
        "name",
        "description",
        "risk",
        "permissions",
        "inputSchema",
        "outputSchema",
      ],
      ["title"],
      prefix,
    );
    if (checked.issue !== undefined) return { issue: checked.issue };
    const tool = checked.value;
    const nameIssue = validPattern(
      tool.name,
      TOOL_NAME,
      "INVALID_IDENTIFIER",
      `${prefix}.name`,
    );
    if (nameIssue !== undefined) return { issue: nameIssue };
    if (!(tool.name as string).startsWith(`${publisher}.`)) {
      return { issue: issue("INVALID_IDENTIFIER", `${prefix}.name`) };
    }
    if (names.has(tool.name as string)) {
      return { issue: issue("DUPLICATE_VALUE", `${prefix}.name`) };
    }
    names.add(tool.name as string);
    const textIssue =
      boundedText(tool.description, 1, 1024, `${prefix}.description`) ??
      (Object.hasOwn(tool, "title")
        ? boundedText(tool.title, 1, 128, `${prefix}.title`)
        : undefined);
    if (textIssue !== undefined) return { issue: textIssue };
    const permissionIssue = validatePermissions(tool, prefix);
    if (permissionIssue !== undefined) return { issue: permissionIssue };
    const schemaIssue =
      closedSchemaIssue(tool.inputSchema, `${prefix}.inputSchema`) ??
      closedSchemaIssue(tool.outputSchema, `${prefix}.outputSchema`);
    if (schemaIssue !== undefined) return { issue: schemaIssue };
  }
  return { names };
}

export function validateFixtures(
  value: unknown,
  tools: Set<string>,
): PackManifestValidationIssue | undefined {
  if (!boundedArray(value, 1, 256)) return issue("LIMIT_EXCEEDED", "fixtures");
  const ids = new Set<string>();
  const coveredTools = new Set<string>();
  for (const [index, candidate] of value.entries()) {
    const prefix = `fixtures[${index}]`;
    const checked = closedObject(
      candidate,
      ["id", "tool", "input", "expect"],
      [],
      prefix,
    );
    if (checked.issue !== undefined) return checked.issue;
    const fixture = checked.value;
    const idIssue = boundedPattern(
      fixture.id,
      1,
      64,
      FIXTURE_ID,
      `${prefix}.id`,
    );
    if (idIssue !== undefined) return idIssue;
    if (ids.has(fixture.id as string)) {
      return issue("DUPLICATE_VALUE", `${prefix}.id`);
    }
    ids.add(fixture.id as string);
    if (typeof fixture.tool !== "string" || !tools.has(fixture.tool)) {
      return issue("INVALID_REFERENCE", `${prefix}.tool`);
    }
    coveredTools.add(fixture.tool);
    if (!isRecord(fixture.input))
      return issue("INVALID_TYPE", `${prefix}.input`);
    const expectation = validateFixtureExpectation(
      fixture.expect,
      `${prefix}.expect`,
    );
    if (expectation !== undefined) return expectation;
  }
  for (const tool of tools) {
    if (!coveredTools.has(tool)) return issue("INVALID_REFERENCE", "fixtures");
  }
  return undefined;
}

function validatePermissions(
  tool: RecordValue,
  prefix: string,
): PackManifestValidationIssue | undefined {
  if (!boundedArray(tool.permissions, 1, 6)) {
    return issue("LIMIT_EXCEEDED", `${prefix}.permissions`);
  }
  const permissions = tool.permissions;
  if (
    permissions.some((permission) => !PERMISSIONS.has(String(permission))) ||
    new Set(permissions).size !== permissions.length
  ) {
    return issue("INVALID_PERMISSION", `${prefix}.permissions`);
  }
  const required =
    tool.risk === "read"
      ? "READ"
      : tool.risk === "action"
        ? "ACTION"
        : tool.risk === "sensitive"
          ? "SENSITIVE"
          : undefined;
  return required !== undefined && permissions.includes(required)
    ? undefined
    : issue("INVALID_PERMISSION", `${prefix}.risk`);
}

function validateFixtureExpectation(
  value: unknown,
  prefix: string,
): PackManifestValidationIssue | undefined {
  if (!isRecord(value)) return issue("INVALID_TYPE", prefix);
  if (value.kind === "result") {
    return closedObject(value, ["kind", "result"], [], prefix).issue;
  }
  if (value.kind === "error") {
    const checked = closedObject(value, ["kind", "code"], [], prefix);
    if (checked.issue !== undefined) return checked.issue;
    return FIXTURE_ERROR_CODES.has(String(value.code))
      ? undefined
      : issue("INVALID_VALUE", `${prefix}.code`);
  }
  return issue("INVALID_VALUE", `${prefix}.kind`);
}
