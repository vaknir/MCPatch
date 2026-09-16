import {
  JIRA_FINGERPRINT,
  JiraPackError,
  type JiraLinkIssuesInput,
  type JiraLinkIssuesResult,
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
  closedInput,
  dataValue,
  invalidArguments,
  requiredPattern,
  requiredText,
} from "./validation.js";

const MAX_LINKS = 256;

export function validateJiraLinkIssuesInput(
  value: unknown,
): JiraLinkIssuesInput {
  const fields = ["inwardIssueKey", "outwardIssueKey", "linkType"];
  const source = closedInput(value, fields, fields);
  const input = Object.freeze({
    inwardIssueKey: requiredPattern(
      dataValue(source, "inwardIssueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    outwardIssueKey: requiredPattern(
      dataValue(source, "outwardIssueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    linkType: requiredText(
      dataValue(source, "linkType"),
      1,
      JIRA_MAX_NAME_LENGTH,
    ),
  });
  if (input.inwardIssueKey === input.outwardIssueKey) invalidArguments();
  return input;
}

/**
 * Links two existing issues with one named link type. An existing identical
 * link is a deterministic no-op rather than a duplicate write.
 */
export async function linkJiraIssues(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraLinkIssuesResult> {
  const input = validateJiraLinkIssuesInput(value);
  if (await hasLink(client, input, signal))
    return result("already_linked", input);
  await client.post(
    "/issueLink",
    {
      type: { name: input.linkType },
      inwardIssue: { key: input.inwardIssueKey },
      outwardIssue: { key: input.outwardIssueKey },
    },
    signal,
  );
  const confirmed = await hasLink(client, input, signal);
  return result(confirmed ? "linked" : "created_unconfirmed", input);
}

async function hasLink(
  client: JiraRestClient,
  input: JiraLinkIssuesInput,
  signal: AbortSignal,
): Promise<boolean> {
  const decoded = await client.get(
    `/issue/${input.inwardIssueKey}`,
    { fields: "issuelinks" },
    signal,
  );
  return parseJiraIssueLinks(decoded).some(
    (link) =>
      link.type === input.linkType && link.outwardKey === input.outwardIssueKey,
  );
}

export interface JiraIssueLink {
  readonly type: string;
  readonly outwardKey?: string;
  readonly inwardKey?: string;
}

export function parseJiraIssueLinks(value: unknown): readonly JiraIssueLink[] {
  const fields = responseObject(dataValue(responseObject(value), "fields"));
  const links = responseArray(dataValue(fields, "issuelinks"), MAX_LINKS);
  return Object.freeze(links.map(parseJiraIssueLink));
}

function parseJiraIssueLink(value: unknown): JiraIssueLink {
  const link = responseObject(value);
  const type = responseObject(dataValue(link, "type"));
  const outwardKey = optionalIssueKey(dataValue(link, "outwardIssue"));
  const inwardKey = optionalIssueKey(dataValue(link, "inwardIssue"));
  return Object.freeze({
    type: optionalResponseField(type, "name", JIRA_MAX_NAME_LENGTH) ?? "",
    ...(outwardKey === undefined ? {} : { outwardKey }),
    ...(inwardKey === undefined ? {} : { inwardKey }),
  });
}

function optionalIssueKey(value: unknown): string | undefined {
  const key = optionalResponseField(value, "key", 21);
  if (key === undefined) return undefined;
  if (!JIRA_ISSUE_KEY.test(key)) {
    throw new JiraPackError("EXECUTION_FAILED", "ambiguous_value");
  }
  return key;
}

function result(
  state: JiraLinkIssuesResult["state"],
  input: JiraLinkIssuesInput,
): JiraLinkIssuesResult {
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state,
    inwardIssueKey: input.inwardIssueKey,
    outwardIssueKey: input.outwardIssueKey,
    linkType: input.linkType,
  });
}
