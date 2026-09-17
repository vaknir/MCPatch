import {
  JIRA_FINGERPRINT,
  type JiraAddWorklogInput,
  type JiraAddWorklogResult,
  type JiraListCommentsInput,
  type JiraListWorklogsResult,
  type JiraWorklogEntry,
} from "./model.js";
import {
  JIRA_MAX_BODY_LENGTH,
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
  JIRA_MAX_PAGE_SIZE,
  JIRA_MAX_TEXT_LENGTH,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  invalidArguments,
  optionalBody,
  optionalInteger,
  optionalText,
  requiredPattern,
} from "./validation.js";

/** Jira's own duration grammar, e.g. "3h", "1d 4h", "90m". */
const TIME_SPENT = /^\d{1,4}[wdhm](?: \d{1,4}[wdhm]){0,3}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_SECONDS = 100_000_000;

export function validateJiraListWorklogsInput(
  value: unknown,
): Required<JiraListCommentsInput> {
  const source = closedInput(value, ["issueKey", "limit"], ["issueKey"]);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

export function validateJiraAddWorklogInput(
  value: unknown,
): JiraAddWorklogInput {
  const source = closedInput(
    value,
    ["issueKey", "timeSpent", "startedAt", "comment"],
    ["issueKey", "timeSpent"],
  );
  const startedAt = optionalText(source, "startedAt", 24, 24);
  if (startedAt !== undefined && !isInstant(startedAt)) invalidArguments();
  const comment = optionalBody(source, "comment", 1, JIRA_MAX_TEXT_LENGTH);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    timeSpent: requiredPattern(dataValue(source, "timeSpent"), TIME_SPENT, 24),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(comment === undefined ? {} : { comment }),
  });
}

export async function listJiraWorklogs(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListWorklogsResult> {
  const input = validateJiraListWorklogsInput(value);
  const decoded = await client.get(
    `/issue/${input.issueKey}/worklog`,
    { maxResults: String(input.limit) },
    signal,
  );
  const page = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    issueKey: input.issueKey,
    total: responseCount(dataValue(page, "total"), Number.MAX_SAFE_INTEGER),
    worklogs: Object.freeze(
      responseArray(dataValue(page, "worklogs"), input.limit).map(
        parseJiraWorklog,
      ),
    ),
  });
}

export function parseJiraWorklog(value: unknown): JiraWorklogEntry {
  const worklog = responseObject(value);
  const author = optionalResponseUser(dataValue(worklog, "author"));
  const comment = truncateResponseText(
    dataValue(worklog, "comment"),
    JIRA_MAX_BODY_LENGTH,
  );
  return Object.freeze({
    id: responseId(dataValue(worklog, "id"), JIRA_NUMERIC_ID),
    ...(author === undefined ? {} : { author }),
    started: responseField(worklog, "started", MAX_TIMESTAMP_LENGTH),
    timeSpent: responseField(worklog, "timeSpent", 64),
    timeSpentSeconds: responseCount(
      dataValue(worklog, "timeSpentSeconds"),
      MAX_SECONDS,
    ),
    ...(comment === undefined ? {} : { comment: comment.text }),
  });
}

/**
 * Appends one worklog. Jira's own estimate adjustment stays on `auto`; the
 * caller cannot set a remaining estimate or rewrite an existing entry.
 */
export async function addJiraWorklog(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraAddWorklogResult> {
  const input = validateJiraAddWorklogInput(value);
  const decoded = await client.post(
    `/issue/${input.issueKey}/worklog`,
    {
      timeSpent: input.timeSpent,
      ...(input.startedAt === undefined
        ? {}
        : { started: toJiraInstant(input.startedAt) }),
      ...(input.comment === undefined ? {} : { comment: input.comment }),
    },
    signal,
  );
  const created = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: "added",
    issueKey: input.issueKey,
    worklogId: responseId(dataValue(created, "id"), JIRA_NUMERIC_ID),
    timeSpent:
      optionalResponseField(created, "timeSpent", 64) ?? input.timeSpent,
    timeSpentSeconds: responseCount(
      dataValue(created, "timeSpentSeconds"),
      MAX_SECONDS,
    ),
  });
}

/** Jira Data Center expects `+0000` rather than the ISO-8601 `Z` suffix. */
export function toJiraInstant(value: string): string {
  return `${value.slice(0, -1)}+0000`;
}

function isInstant(value: string): boolean {
  if (!INSTANT.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}
