import type { JsonObject } from "@mcpatch/sdk/runtime";

import {
  JIRA_FINGERPRINT,
  JiraPackError,
  type JiraUpdatableField,
  type JiraUpdateIssueInput,
  type JiraUpdateIssueResult,
} from "./model.js";
import {
  optionalResponseField,
  responseArray,
  responseObject,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_ISSUE_KEY,
  JIRA_MAX_NAME_LENGTH,
  JIRA_MAX_SUMMARY_LENGTH,
  JIRA_MAX_TEXT_LENGTH,
  closedInput,
  dataValue,
  optionalBody,
  optionalLabels,
  optionalText,
  requiredPattern,
} from "./validation.js";

const DUE_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAX_LABELS = 64;
/** Exactly the fields this tool may set, in a stable reported order. */
const UPDATABLE_FIELDS = Object.freeze([
  "description",
  "dueDate",
  "labels",
  "priority",
  "summary",
] as const);
const CONFIRM_FIELDS = "summary,description,priority,labels,duedate";

export function validateJiraUpdateIssueInput(
  value: unknown,
): JiraUpdateIssueInput {
  const source = closedInput(
    value,
    ["issueKey", ...UPDATABLE_FIELDS],
    ["issueKey"],
  );
  const labels = optionalLabels(source, "labels");
  const dueDate = optionalText(source, "dueDate", 10, 10);
  if (dueDate !== undefined && !isCalendarDate(dueDate)) invalidUpdate();
  const input = Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    ...optional(
      "summary",
      optionalText(source, "summary", 1, JIRA_MAX_SUMMARY_LENGTH),
    ),
    ...optional(
      "description",
      optionalBody(source, "description", 1, JIRA_MAX_TEXT_LENGTH),
    ),
    ...optional(
      "priority",
      optionalText(source, "priority", 1, JIRA_MAX_NAME_LENGTH),
    ),
    ...(labels === undefined ? {} : { labels }),
    ...optional("dueDate", dueDate),
  });
  if (selectedFields(input).length === 0) {
    throw new JiraPackError("EXECUTION_FAILED", "no_updatable_field");
  }
  return input;
}

/**
 * Sets only named reviewed fields, so every changed value is visible in the
 * approval hash. Raw field ids and custom fields are not expressible.
 */
export async function updateJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraUpdateIssueResult> {
  const input = validateJiraUpdateIssueInput(value);
  await client.put(`/issue/${input.issueKey}`, updatePayload(input), signal);
  const stored = await readStoredFields(client, input.issueKey, signal);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: matches(input, stored) ? "confirmed" : "applied_unconfirmed",
    issueKey: input.issueKey,
    updatedFields: selectedFields(input),
  });
}

export function updatePayload(input: JiraUpdateIssueInput): JsonObject {
  return {
    fields: {
      ...(input.summary === undefined ? {} : { summary: input.summary }),
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.priority === undefined
        ? {}
        : { priority: { name: input.priority } }),
      ...(input.labels === undefined ? {} : { labels: [...input.labels] }),
      ...(input.dueDate === undefined ? {} : { duedate: input.dueDate }),
    },
  };
}

export function selectedFields(
  input: JiraUpdateIssueInput,
): readonly JiraUpdatableField[] {
  return Object.freeze(
    UPDATABLE_FIELDS.filter((field) => input[field] !== undefined),
  );
}

interface StoredFields {
  readonly summary?: string;
  readonly description?: string;
  readonly priority?: string;
  readonly labels?: readonly string[];
  readonly dueDate?: string;
}

/** A failed confirmation read must not turn a completed write into an error. */
async function readStoredFields(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<StoredFields | undefined> {
  try {
    const decoded = await client.get(
      `/issue/${issueKey}`,
      { fields: CONFIRM_FIELDS },
      signal,
    );
    const fields = responseObject(dataValue(responseObject(decoded), "fields"));
    const labels = dataValue(fields, "labels");
    return Object.freeze({
      ...optional(
        "summary",
        optionalResponseField(fields, "summary", JIRA_MAX_SUMMARY_LENGTH),
      ),
      ...optional("description", storedText(dataValue(fields, "description"))),
      ...optional(
        "priority",
        optionalResponseField(
          dataValue(fields, "priority"),
          "name",
          JIRA_MAX_NAME_LENGTH,
        ),
      ),
      ...(labels === undefined || labels === null
        ? {}
        : { labels: storedLabels(labels) }),
      ...optional("dueDate", optionalResponseField(fields, "duedate", 10)),
    });
  } catch (error) {
    if (error instanceof JiraPackError && error.code === "CANCELLED") {
      throw error;
    }
    return undefined;
  }
}

/**
 * Compares the untruncated stored value, so a long description is confirmed
 * exactly rather than against the excerpt a read tool would return.
 */
function matches(
  input: JiraUpdateIssueInput,
  stored: StoredFields | undefined,
): boolean {
  if (stored === undefined) return false;
  return selectedFields(input).every((field) =>
    field === "labels"
      ? sameLabels(input.labels, stored.labels)
      : input[field] === stored[field],
  );
}

function sameLabels(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return false;
  const stored = new Set(right);
  return left.length === stored.size && left.every((l) => stored.has(l));
}

function storedText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return text.length === 0 || text.length > JIRA_MAX_TEXT_LENGTH
    ? undefined
    : text;
}

function storedLabels(value: unknown): readonly string[] {
  return Object.freeze(
    responseArray(value, MAX_LABELS).map((label) =>
      typeof label === "string" ? label : "",
    ),
  );
}

/** Rejects a syntactically valid but non-existent date such as 2026-02-30. */
function isCalendarDate(value: string): boolean {
  if (!DUE_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

function optional(key: string, value: string | undefined): object {
  return value === undefined ? {} : { [key]: value };
}

function invalidUpdate(): never {
  throw new JiraPackError("EXECUTION_FAILED", "invalid_arguments");
}
