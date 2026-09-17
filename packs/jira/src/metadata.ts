import {
  JIRA_FINGERPRINT,
  type JiraGetUserInput,
  type JiraGetUserResult,
  type JiraIssueLinkType,
  type JiraListIssueLinkTypesResult,
} from "./model.js";
import {
  responseArray,
  responseField,
  responseId,
  responseObject,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_MAX_NAME_LENGTH,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  requiredText,
} from "./validation.js";

const MAX_LINK_TYPES = 64;
const MAX_USERNAME_LENGTH = 255;
const EMPTY_INPUT: readonly string[] = [];

export function validateJiraGetUserInput(value: unknown): JiraGetUserInput {
  const source = closedInput(value, ["username"], ["username"]);
  return Object.freeze({
    username: requiredText(
      dataValue(source, "username"),
      1,
      MAX_USERNAME_LENGTH,
    ),
  });
}

/**
 * Makes link types discoverable, so `jira.link_issues` is given an exact server
 * name instead of a guess, exactly as transitions work for status changes.
 */
export async function listJiraIssueLinkTypes(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListIssueLinkTypesResult> {
  closedInput(value, EMPTY_INPUT, EMPTY_INPUT);
  const decoded = await client.get("/issueLinkType", {}, signal);
  const page = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    linkTypes: Object.freeze(
      responseArray(dataValue(page, "issueLinkTypes"), MAX_LINK_TYPES).map(
        parseJiraIssueLinkType,
      ),
    ),
  });
}

function parseJiraIssueLinkType(value: unknown): JiraIssueLinkType {
  const type = responseObject(value);
  return Object.freeze({
    id: responseId(dataValue(type, "id"), JIRA_NUMERIC_ID),
    name: responseField(type, "name", JIRA_MAX_NAME_LENGTH),
    inward: responseField(type, "inward", 255),
    outward: responseField(type, "outward", 255),
  });
}

/** Returns a user's stable identity only; no email, avatar, or group data. */
export async function getJiraUser(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraGetUserResult> {
  const input = validateJiraGetUserInput(value);
  const decoded = await client.get(
    "/user",
    { username: input.username },
    signal,
  );
  const user = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    name: responseField(user, "name", MAX_USERNAME_LENGTH),
    displayName: responseField(user, "displayName", 255),
    active: dataValue(user, "active") === true,
  });
}
