import {
  JIRA_FINGERPRINT,
  type JiraGetIssueInput,
  type JiraIssueResult,
  type JiraIssueSummary,
  type JiraSearchIssuesInput,
  type JiraSearchIssuesResult,
} from "./model.js";
import {
  JIRA_MAX_BODY_LENGTH,
  ambiguous,
  optionalResponseField,
  optionalResponseUser,
  responseArray,
  responseCount,
  responseField,
  responseId,
  responseObject,
  truncateResponseText,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_DEFAULT_PAGE_SIZE,
  JIRA_ISSUE_KEY,
  JIRA_MAX_JQL_LENGTH,
  JIRA_MAX_PAGE_SIZE,
  JIRA_MAX_START_AT,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  optionalInteger,
  requiredPattern,
  requiredText,
} from "./validation.js";

const MAX_LABELS = 64;
const MAX_TIMESTAMP_LENGTH = 64;
const SUMMARY_FIELDS =
  "summary,status,issuetype,project,priority,assignee,updated";
const ISSUE_FIELDS = `${SUMMARY_FIELDS},reporter,created,labels,resolution,description`;

export function validateJiraGetIssueInput(value: unknown): JiraGetIssueInput {
  const source = closedInput(value, ["issueKey"], ["issueKey"]);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
  });
}

export function validateJiraSearchInput(
  value: unknown,
): Required<JiraSearchIssuesInput> {
  const source = closedInput(value, ["jql", "limit", "startAt"], ["jql"]);
  return Object.freeze({
    jql: requiredText(dataValue(source, "jql"), 1, JIRA_MAX_JQL_LENGTH),
    startAt: optionalInteger(source, "startAt", 0, JIRA_MAX_START_AT, 0),
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

export async function getJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraIssueResult> {
  const input = validateJiraGetIssueInput(value);
  const decoded = await client.get(
    `/issue/${input.issueKey}`,
    { fields: ISSUE_FIELDS },
    signal,
  );
  return parseJiraIssue(decoded);
}

export async function searchJiraIssues(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraSearchIssuesResult> {
  const input = validateJiraSearchInput(value);
  const decoded = await client.get(
    "/search",
    {
      jql: input.jql,
      startAt: String(input.startAt),
      maxResults: String(input.limit),
      fields: SUMMARY_FIELDS,
      validateQuery: "strict",
    },
    signal,
  );
  return parseJiraSearchResponse(decoded, input);
}

export function parseJiraSearchResponse(
  value: unknown,
  input: Required<JiraSearchIssuesInput>,
): JiraSearchIssuesResult {
  const page = responseObject(value);
  const issues = responseArray(dataValue(page, "issues"), input.limit);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    jql: input.jql,
    startAt: responseCount(dataValue(page, "startAt"), JIRA_MAX_START_AT),
    total: responseCount(dataValue(page, "total"), Number.MAX_SAFE_INTEGER),
    issues: Object.freeze(issues.map(parseJiraIssueSummary)),
  });
}

export function parseJiraIssueSummary(value: unknown): JiraIssueSummary {
  const issue = responseObject(value);
  const fields = responseObject(dataValue(issue, "fields"));
  const status = responseObject(dataValue(fields, "status"));
  const category = responseObject(dataValue(status, "statusCategory"));
  return Object.freeze({
    key: responseId(dataValue(issue, "key"), JIRA_ISSUE_KEY),
    summary: responseField(fields, "summary", 1_024),
    status: responseField(status, "name"),
    statusCategory: responseField(category, "name"),
    issueType: responseField(
      responseObject(dataValue(fields, "issuetype")),
      "name",
    ),
    projectKey: responseField(
      responseObject(dataValue(fields, "project")),
      "key",
    ),
    ...optionalName(dataValue(fields, "priority"), "priority"),
    ...optionalAssignee(dataValue(fields, "assignee")),
    updated: responseField(fields, "updated", MAX_TIMESTAMP_LENGTH),
  });
}

export function parseJiraIssue(value: unknown): JiraIssueResult {
  const issue = responseObject(value);
  const fields = responseObject(dataValue(issue, "fields"));
  const description = truncateResponseText(
    dataValue(fields, "description"),
    JIRA_MAX_BODY_LENGTH,
  );
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    id: responseId(dataValue(issue, "id"), JIRA_NUMERIC_ID),
    ...parseJiraIssueSummary(issue),
    ...optionalReporter(dataValue(fields, "reporter")),
    ...optionalName(dataValue(fields, "resolution"), "resolution"),
    labels: parseLabels(dataValue(fields, "labels")),
    created: responseField(fields, "created", MAX_TIMESTAMP_LENGTH),
    ...(description === undefined ? {} : { description: description.text }),
    descriptionTruncated: description?.truncated === true,
  });
}

function parseLabels(value: unknown): readonly string[] {
  if (value === undefined || value === null) return Object.freeze([]);
  const labels = responseArray(value, MAX_LABELS).map((label) => {
    if (typeof label !== "string" || label.length > 255) ambiguous();
    return label;
  });
  return Object.freeze(labels);
}

function optionalName(
  value: unknown,
  field: "priority" | "resolution",
): Record<string, string> {
  const name = optionalResponseField(value, "name");
  return name === undefined ? {} : { [field]: name };
}

function optionalAssignee(value: unknown): Pick<JiraIssueSummary, "assignee"> {
  const assignee = optionalResponseUser(value);
  return assignee === undefined ? {} : { assignee };
}

function optionalReporter(value: unknown): Pick<JiraIssueResult, "reporter"> {
  const reporter = optionalResponseUser(value);
  return reporter === undefined ? {} : { reporter };
}
