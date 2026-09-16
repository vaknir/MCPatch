import type { JsonObject } from "@mcpatch/sdk/runtime";

import {
  JIRA_FINGERPRINT,
  type JiraCreateIssueInput,
  type JiraCreateIssueResult,
} from "./model.js";
import { responseId, responseObject } from "./response.js";
import type { JiraRestClient } from "./rest.js";
import { validateJiraProjectKey } from "./projects.js";
import {
  JIRA_ISSUE_KEY,
  JIRA_MAX_NAME_LENGTH,
  JIRA_MAX_SUMMARY_LENGTH,
  JIRA_MAX_TEXT_LENGTH,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  optionalBody,
  optionalLabels,
  requiredText,
} from "./validation.js";

const FIELDS = ["projectKey", "issueType", "summary", "description", "labels"];

export function validateJiraCreateIssueInput(
  value: unknown,
): JiraCreateIssueInput {
  const source = closedInput(value, FIELDS, [
    "projectKey",
    "issueType",
    "summary",
  ]);
  const description = optionalBody(
    source,
    "description",
    1,
    JIRA_MAX_TEXT_LENGTH,
  );
  const labels = optionalLabels(source, "labels");
  return Object.freeze({
    projectKey: validateJiraProjectKey(dataValue(source, "projectKey")),
    issueType: requiredText(
      dataValue(source, "issueType"),
      1,
      JIRA_MAX_NAME_LENGTH,
    ),
    summary: requiredText(
      dataValue(source, "summary"),
      1,
      JIRA_MAX_SUMMARY_LENGTH,
    ),
    ...(description === undefined ? {} : { description }),
    ...(labels === undefined ? {} : { labels }),
  });
}

/**
 * Creates exactly one issue from validated fields. The agent cannot supply raw
 * field ids, custom fields, a parent, a reporter, or a security level.
 */
export async function createJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraCreateIssueResult> {
  const input = validateJiraCreateIssueInput(value);
  const decoded = await client.post("/issue", issuePayload(input), signal);
  const created = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: "created",
    issueKey: responseId(dataValue(created, "key"), JIRA_ISSUE_KEY),
    id: responseId(dataValue(created, "id"), JIRA_NUMERIC_ID),
    projectKey: input.projectKey,
    issueType: input.issueType,
  });
}

export function issuePayload(input: JiraCreateIssueInput): JsonObject {
  return {
    fields: {
      project: { key: input.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.labels === undefined ? {} : { labels: [...input.labels] }),
    },
  };
}
