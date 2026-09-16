import {
  JIRA_FINGERPRINT,
  JiraPackError,
  type JiraGetIssueInput,
  type JiraIssueLink,
  type JiraLinkIssuesInput,
  type JiraLinkIssuesResult,
  type JiraListIssueLinksResult,
  type JiraRemoveIssueLinkInput,
  type JiraRemoveIssueLinkResult,
} from "./model.js";
import {
  optionalResponseField,
  responseArray,
  responseId,
  responseObject,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_ISSUE_KEY,
  JIRA_MAX_NAME_LENGTH,
  JIRA_NUMERIC_ID,
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

export function validateJiraListIssueLinksInput(
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

export function validateJiraRemoveIssueLinkInput(
  value: unknown,
): JiraRemoveIssueLinkInput {
  const fields = ["issueKey", "linkId"];
  const source = closedInput(value, fields, fields);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    linkId: requiredPattern(dataValue(source, "linkId"), JIRA_NUMERIC_ID, 19),
  });
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

export async function listJiraIssueLinks(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListIssueLinksResult> {
  const input = validateJiraListIssueLinksInput(value);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    issueKey: input.issueKey,
    links: await readLinks(client, input.issueKey, signal),
  });
}

/**
 * Removes one link by exact id, but only after proving that id is on the issue
 * the approval named. Without that binding a link id would reach every link in
 * the instance rather than the one the user reviewed.
 */
export async function removeJiraIssueLink(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraRemoveIssueLinkResult> {
  const input = validateJiraRemoveIssueLinkInput(value);
  const before = await readLinks(client, input.issueKey, signal);
  if (!before.some((link) => link.id === input.linkId)) {
    throw new JiraPackError("EXECUTION_FAILED", "unknown_issue_link");
  }
  await client.remove(`/issueLink/${input.linkId}`, signal);
  const after = await readLinks(client, input.issueKey, signal);
  const removed = !after.some((link) => link.id === input.linkId);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: removed ? "removed" : "removed_unconfirmed",
    issueKey: input.issueKey,
    linkId: input.linkId,
  });
}

async function readLinks(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<readonly JiraIssueLink[]> {
  const decoded = await client.get(
    `/issue/${issueKey}`,
    { fields: "issuelinks" },
    signal,
  );
  return parseJiraIssueLinks(decoded);
}

async function hasLink(
  client: JiraRestClient,
  input: JiraLinkIssuesInput,
  signal: AbortSignal,
): Promise<boolean> {
  const links = await readLinks(client, input.inwardIssueKey, signal);
  return links.some(
    (link) =>
      link.type === input.linkType &&
      link.direction === "outward" &&
      link.otherIssueKey === input.outwardIssueKey,
  );
}

export function parseJiraIssueLinks(value: unknown): readonly JiraIssueLink[] {
  const fields = responseObject(dataValue(responseObject(value), "fields"));
  const links = responseArray(dataValue(fields, "issuelinks"), MAX_LINKS);
  return Object.freeze(links.flatMap((link) => parseJiraIssueLink(link) ?? []));
}

/** A link with neither side resolvable is dropped rather than half-reported. */
function parseJiraIssueLink(value: unknown): JiraIssueLink | undefined {
  const link = responseObject(value);
  const outwardKey = optionalIssueKey(dataValue(link, "outwardIssue"));
  const inwardKey = optionalIssueKey(dataValue(link, "inwardIssue"));
  const type = optionalResponseField(
    dataValue(link, "type"),
    "name",
    JIRA_MAX_NAME_LENGTH,
  );
  if (type === undefined) return undefined;
  const direction = outwardKey === undefined ? "inward" : "outward";
  const otherIssueKey = outwardKey ?? inwardKey;
  if (otherIssueKey === undefined) return undefined;
  return Object.freeze({
    id: responseId(dataValue(link, "id"), JIRA_NUMERIC_ID),
    type,
    direction,
    otherIssueKey,
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
