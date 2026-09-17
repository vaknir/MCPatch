import { JiraPackError, type JiraUser } from "./model.js";
import { dataValue, isDataObject } from "./validation.js";

export const JIRA_MAX_FIELD_LENGTH = 512;
export const JIRA_MAX_BODY_LENGTH = 4_096;

export function ambiguous(): never {
  throw new JiraPackError("EXECUTION_FAILED", "ambiguous_value");
}

export function missing(): never {
  throw new JiraPackError("EXECUTION_FAILED", "missing_value");
}

export function responseObject(value: unknown): Record<string, unknown> {
  if (!isDataObject(value)) ambiguous();
  return value;
}

export function responseArray(
  value: unknown,
  maximum: number,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > maximum) ambiguous();
  return value;
}

export function responseText(value: unknown, maximum: number): string {
  if (typeof value !== "string") missing();
  const text = value.trim();
  if (text.length === 0 || text.length > maximum) ambiguous();
  return text;
}

export function optionalResponseText(
  value: unknown,
  maximum: number,
): string | undefined {
  return value === undefined || value === null
    ? undefined
    : responseText(value, maximum);
}

export function responseCount(value: unknown, maximum: number): number {
  const parsed =
    typeof value === "number" && Number.isSafeInteger(value)
      ? value
      : undefined;
  if (parsed === undefined || parsed < 0 || parsed > maximum) ambiguous();
  return parsed;
}

/** Jira ids arrive as strings or numbers depending on endpoint and version. */
export function responseId(value: unknown, pattern: RegExp): string {
  const text =
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : value;
  if (typeof text !== "string" || !pattern.test(text)) ambiguous();
  return text;
}

export function responseField(
  value: unknown,
  field: string,
  maximum = JIRA_MAX_FIELD_LENGTH,
): string {
  return responseText(dataValue(value, field), maximum);
}

export function optionalResponseField(
  value: unknown,
  field: string,
  maximum = JIRA_MAX_FIELD_LENGTH,
): string | undefined {
  return optionalResponseText(dataValue(value, field), maximum);
}

/** Returns a user's stable name and display name only; no email or avatar. */
export function optionalResponseUser(value: unknown): JiraUser | undefined {
  if (!isDataObject(value)) return undefined;
  const name = optionalResponseField(value, "name", 255);
  const displayName = optionalResponseField(value, "displayName");
  if (name === undefined || displayName === undefined) return undefined;
  return Object.freeze({ name, displayName });
}

export interface TruncatedText {
  readonly text: string;
  readonly truncated: boolean;
}

export function truncateResponseText(
  value: unknown,
  maximum: number,
): TruncatedText | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (text.length === 0) return undefined;
  return Object.freeze({
    text: sliceWholeCodePoints(text, maximum),
    truncated: text.length > maximum,
  });
}

/** Never emits the lone surrogate a raw slice can leave at the cut point. */
function sliceWholeCodePoints(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const cut = value.slice(0, maximum);
  const last = cut.charCodeAt(maximum - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
