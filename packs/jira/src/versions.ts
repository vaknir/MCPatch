import {
  JIRA_FINGERPRINT,
  type JiraCreateVersionInput,
  type JiraCreateVersionResult,
  type JiraListVersionsInput,
  type JiraListVersionsResult,
  type JiraVersion,
} from "./model.js";
import {
  optionalResponseField,
  responseArray,
  responseField,
  responseId,
  responseObject,
  truncateResponseText,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import { validateJiraProjectKey } from "./projects.js";
import {
  JIRA_DEFAULT_PAGE_SIZE,
  JIRA_MAX_PAGE_SIZE,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  invalidArguments,
  optionalInteger,
  optionalText,
  requiredText,
} from "./validation.js";

const MAX_SOURCE_VERSIONS = 1_024;
const MAX_VERSION_NAME_LENGTH = 255;
const MAX_DESCRIPTION_LENGTH = 1_024;
const RELEASE_DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function validateJiraListVersionsInput(
  value: unknown,
): Required<JiraListVersionsInput> {
  const source = closedInput(value, ["projectKey", "limit"], ["projectKey"]);
  return Object.freeze({
    projectKey: validateJiraProjectKey(dataValue(source, "projectKey")),
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

export function validateJiraCreateVersionInput(
  value: unknown,
): JiraCreateVersionInput {
  const source = closedInput(
    value,
    ["projectKey", "name", "description", "releaseDate"],
    ["projectKey", "name"],
  );
  const releaseDate = optionalText(source, "releaseDate", 10, 10);
  if (releaseDate !== undefined && !isCalendarDate(releaseDate)) {
    invalidArguments();
  }
  const description = optionalText(
    source,
    "description",
    1,
    MAX_DESCRIPTION_LENGTH,
  );
  return Object.freeze({
    projectKey: validateJiraProjectKey(dataValue(source, "projectKey")),
    name: requiredText(dataValue(source, "name"), 1, MAX_VERSION_NAME_LENGTH),
    ...(description === undefined ? {} : { description }),
    ...(releaseDate === undefined ? {} : { releaseDate }),
  });
}

export async function listJiraVersions(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListVersionsResult> {
  const input = validateJiraListVersionsInput(value);
  const decoded = await client.get(
    `/project/${input.projectKey}/versions`,
    {},
    signal,
  );
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    projectKey: input.projectKey,
    versions: Object.freeze(
      responseArray(decoded, MAX_SOURCE_VERSIONS)
        .slice(0, input.limit)
        .map(parseJiraVersion),
    ),
  });
}

export function parseJiraVersion(value: unknown): JiraVersion {
  const version = responseObject(value);
  const releaseDate = optionalResponseField(version, "releaseDate", 10);
  const description = truncateResponseText(
    dataValue(version, "description"),
    MAX_DESCRIPTION_LENGTH,
  );
  return Object.freeze({
    id: responseId(dataValue(version, "id"), JIRA_NUMERIC_ID),
    name: responseField(version, "name", MAX_VERSION_NAME_LENGTH),
    released: dataValue(version, "released") === true,
    archived: dataValue(version, "archived") === true,
    ...(releaseDate === undefined ? {} : { releaseDate }),
    ...(description === undefined ? {} : { description: description.text }),
  });
}

/** Creates one unreleased, unarchived version from named bounded fields. */
export async function createJiraVersion(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraCreateVersionResult> {
  const input = validateJiraCreateVersionInput(value);
  const decoded = await client.post(
    "/version",
    {
      project: input.projectKey,
      name: input.name,
      ...(input.description === undefined
        ? {}
        : { description: input.description }),
      ...(input.releaseDate === undefined
        ? {}
        : { releaseDate: input.releaseDate }),
    },
    signal,
  );
  const created = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: "created",
    projectKey: input.projectKey,
    versionId: responseId(dataValue(created, "id"), JIRA_NUMERIC_ID),
    name: responseField(created, "name", MAX_VERSION_NAME_LENGTH),
  });
}

function isCalendarDate(value: string): boolean {
  if (!RELEASE_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}
