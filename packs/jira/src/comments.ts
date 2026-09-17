import {
  JIRA_FINGERPRINT,
  type JiraAddCommentInput,
  type JiraAddCommentResult,
  type JiraComment,
  type JiraListCommentsInput,
  type JiraListCommentsResult,
} from "./model.js";
import {
  JIRA_MAX_BODY_LENGTH,
  ambiguous,
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
  optionalInteger,
  requiredBody,
  requiredPattern,
} from "./validation.js";

const MAX_TIMESTAMP_LENGTH = 64;

export function validateJiraListCommentsInput(
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

export function validateJiraAddCommentInput(
  value: unknown,
): JiraAddCommentInput {
  const source = closedInput(value, ["issueKey", "body"], ["issueKey", "body"]);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    body: requiredBody(dataValue(source, "body"), 1, JIRA_MAX_TEXT_LENGTH),
  });
}

export async function listJiraComments(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListCommentsResult> {
  const input = validateJiraListCommentsInput(value);
  const decoded = await client.get(
    `/issue/${input.issueKey}/comment`,
    { maxResults: String(input.limit) },
    signal,
  );
  return parseJiraCommentPage(decoded, input);
}

export function parseJiraCommentPage(
  value: unknown,
  input: Required<JiraListCommentsInput>,
): JiraListCommentsResult {
  const page = responseObject(value);
  const comments = responseArray(dataValue(page, "comments"), input.limit);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    issueKey: input.issueKey,
    total: responseCount(dataValue(page, "total"), Number.MAX_SAFE_INTEGER),
    comments: Object.freeze(comments.map(parseJiraComment)),
  });
}

export function parseJiraComment(value: unknown): JiraComment {
  const comment = responseObject(value);
  const body = truncateResponseText(
    dataValue(comment, "body"),
    JIRA_MAX_BODY_LENGTH,
  );
  if (body === undefined) ambiguous();
  const author = optionalResponseUser(dataValue(comment, "author"));
  return Object.freeze({
    id: responseId(dataValue(comment, "id"), JIRA_NUMERIC_ID),
    ...(author === undefined ? {} : { author }),
    created: responseField(comment, "created", MAX_TIMESTAMP_LENGTH),
    updated: responseField(comment, "updated", MAX_TIMESTAMP_LENGTH),
    body: body.text,
    bodyTruncated: body.truncated,
  });
}

export async function addJiraComment(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraAddCommentResult> {
  const input = validateJiraAddCommentInput(value);
  const decoded = await client.post(
    `/issue/${input.issueKey}/comment`,
    { body: input.body },
    signal,
  );
  const created = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: "added",
    issueKey: input.issueKey,
    commentId: responseId(dataValue(created, "id"), JIRA_NUMERIC_ID),
    created: responseField(created, "created", MAX_TIMESTAMP_LENGTH),
  });
}
