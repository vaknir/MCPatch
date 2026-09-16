import {
  JIRA_FINGERPRINT,
  JiraPackError,
  type JiraAssignIssueInput,
  type JiraAssignIssueResult,
  type JiraGetIssueInput,
  type JiraUnassignIssueResult,
} from "./model.js";
import { optionalResponseField, responseObject } from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_ISSUE_KEY,
  closedInput,
  dataValue,
  requiredPattern,
  requiredText,
} from "./validation.js";

const MAX_USERNAME_LENGTH = 255;

/** `null` is a confirmed empty assignee; `undefined` is an unavailable read. */
type StoredAssignee = string | null | undefined;

export function validateJiraAssignIssueInput(
  value: unknown,
): JiraAssignIssueInput {
  const fields = ["issueKey", "assignee"];
  const source = closedInput(value, fields, fields);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    assignee: requiredText(
      dataValue(source, "assignee"),
      1,
      MAX_USERNAME_LENGTH,
    ),
  });
}

export function validateJiraUnassignIssueInput(
  value: unknown,
): JiraGetIssueInput {
  const source = closedInput(value, ["issueKey"], ["issueKey"]);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
  });
}

/**
 * Assigning and unassigning are separate tools rather than one tool with a
 * sentinel value, so neither can be reached by a username that happens to look
 * like the sentinel, and each is approved as the distinct action it is.
 */
export async function assignJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraAssignIssueResult> {
  const input = validateJiraAssignIssueInput(value);
  if ((await readAssignee(client, input.issueKey, signal)) === input.assignee) {
    return assignResult("already_assigned", input);
  }
  await client.put(
    `/issue/${input.issueKey}/assignee`,
    { name: input.assignee },
    signal,
  );
  const stored = await confirmAssignee(client, input.issueKey, signal);
  return assignResult(
    stored === input.assignee ? "assigned" : "assigned_unconfirmed",
    input,
  );
}

export async function unassignJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraUnassignIssueResult> {
  const input = validateJiraUnassignIssueInput(value);
  if ((await readAssignee(client, input.issueKey, signal)) === null) {
    return unassignResult("already_unassigned", input.issueKey);
  }
  await client.put(`/issue/${input.issueKey}/assignee`, { name: null }, signal);
  const stored = await confirmAssignee(client, input.issueKey, signal);
  return unassignResult(
    stored === null ? "unassigned" : "unassigned_unconfirmed",
    input.issueKey,
  );
}

async function readAssignee(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<string | null> {
  const decoded = await client.get(
    `/issue/${issueKey}`,
    { fields: "assignee" },
    signal,
  );
  const fields = responseObject(dataValue(responseObject(decoded), "fields"));
  return (
    optionalResponseField(
      dataValue(fields, "assignee"),
      "name",
      MAX_USERNAME_LENGTH,
    ) ?? null
  );
}

/** A failed confirmation read must not turn a completed write into an error. */
async function confirmAssignee(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<StoredAssignee> {
  try {
    return await readAssignee(client, issueKey, signal);
  } catch (error) {
    if (error instanceof JiraPackError && error.code === "CANCELLED") {
      throw error;
    }
    return undefined;
  }
}

function assignResult(
  state: JiraAssignIssueResult["state"],
  input: JiraAssignIssueInput,
): JiraAssignIssueResult {
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state,
    issueKey: input.issueKey,
    assignee: input.assignee,
  });
}

function unassignResult(
  state: JiraUnassignIssueResult["state"],
  issueKey: string,
): JiraUnassignIssueResult {
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state,
    issueKey,
  });
}
