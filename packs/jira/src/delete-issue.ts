import {
  JIRA_FINGERPRINT,
  JiraPackError,
  type JiraDeleteIssueInput,
  type JiraDeleteIssueResult,
} from "./model.js";
import { responseArray, responseField, responseObject } from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_ISSUE_KEY,
  closedInput,
  dataValue,
  invalidArguments,
  requiredPattern,
} from "./validation.js";

const MAX_SUBTASKS = 256;

export function validateJiraDeleteIssueInput(
  value: unknown,
): JiraDeleteIssueInput {
  const source = closedInput(
    value,
    ["issueKey", "deleteSubtasks"],
    ["issueKey"],
  );
  const deleteSubtasks = dataValue(source, "deleteSubtasks");
  if (
    Object.hasOwn(source, "deleteSubtasks") &&
    typeof deleteSubtasks !== "boolean"
  ) {
    invalidArguments();
  }
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    ...(typeof deleteSubtasks === "boolean" ? { deleteSubtasks } : {}),
  });
}

/**
 * Deletes one issue. This is the only irreversible tool in the pack, so it
 * reads the target first: the approval carries the exact key, the result
 * reports the summary that was destroyed, and cascading subtask deletion must
 * be opted into explicitly rather than inferred from the server's default.
 */
export async function deleteJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraDeleteIssueResult> {
  const input = validateJiraDeleteIssueInput(value);
  const target = await readTarget(client, input.issueKey, signal);
  if (target.subtasks > 0 && input.deleteSubtasks !== true) {
    throw new JiraPackError("EXECUTION_FAILED", "subtasks_present");
  }
  await client.remove(
    `/issue/${input.issueKey}`,
    { deleteSubtasks: input.deleteSubtasks === true ? "true" : "false" },
    signal,
  );
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: "deleted",
    issueKey: input.issueKey,
    summary: target.summary,
    deletedSubtasks: input.deleteSubtasks === true ? target.subtasks : 0,
  });
}

async function readTarget(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<{ readonly summary: string; readonly subtasks: number }> {
  const decoded = await client.get(
    `/issue/${issueKey}`,
    { fields: "summary,subtasks" },
    signal,
  );
  const fields = responseObject(dataValue(responseObject(decoded), "fields"));
  const subtasks = dataValue(fields, "subtasks");
  return Object.freeze({
    summary: responseField(fields, "summary", 1_024),
    subtasks:
      subtasks === undefined || subtasks === null
        ? 0
        : responseArray(subtasks, MAX_SUBTASKS).length,
  });
}
