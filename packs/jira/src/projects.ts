import {
  JIRA_FINGERPRINT,
  type JiraListProjectsResult,
  type JiraListProjectsSelection,
  type JiraProject,
} from "./model.js";
import {
  optionalResponseField,
  responseArray,
  responseField,
  responseId,
  responseObject,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_DEFAULT_PAGE_SIZE,
  JIRA_MAX_NAME_LENGTH,
  JIRA_MAX_PAGE_SIZE,
  JIRA_PROJECT_KEY,
  closedInput,
  dataValue,
  optionalInteger,
  optionalText,
  requiredPattern,
} from "./validation.js";

const MAX_SOURCE_PROJECTS = 4_096;

export function validateJiraListProjectsInput(
  value: unknown,
): JiraListProjectsSelection {
  const source = closedInput(value, ["limit", "query"], []);
  const query = optionalText(source, "query", 1, JIRA_MAX_NAME_LENGTH);
  return Object.freeze({
    ...(query === undefined ? {} : { query }),
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

/**
 * Jira Data Center returns every visible project in one array, so the bounded
 * selection happens in the pack rather than by trusting a server page size.
 */
export async function listJiraProjects(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListProjectsResult> {
  const input = validateJiraListProjectsInput(value);
  const decoded = await client.get("/project", {}, signal);
  return parseJiraProjects(decoded, input);
}

export function parseJiraProjects(
  value: unknown,
  input: JiraListProjectsSelection,
): JiraListProjectsResult {
  const source = responseArray(value, MAX_SOURCE_PROJECTS);
  const needle = input.query?.toLowerCase();
  const projects: JiraProject[] = [];
  for (const candidate of source) {
    if (projects.length >= input.limit) break;
    const project = parseJiraProject(candidate);
    if (needle !== undefined && !matches(project, needle)) continue;
    projects.push(project);
  }
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    projects: Object.freeze(projects),
  });
}

function parseJiraProject(value: unknown): JiraProject {
  const project = responseObject(value);
  const projectTypeKey = optionalResponseField(
    project,
    "projectTypeKey",
    JIRA_MAX_NAME_LENGTH,
  );
  return Object.freeze({
    key: responseId(dataValue(project, "key"), JIRA_PROJECT_KEY),
    name: responseField(project, "name", 255),
    ...(projectTypeKey === undefined ? {} : { projectTypeKey }),
  });
}

function matches(project: JiraProject, needle: string): boolean {
  return (
    project.key.toLowerCase().includes(needle) ||
    project.name.toLowerCase().includes(needle)
  );
}

export function validateJiraProjectKey(value: unknown): string {
  return requiredPattern(value, JIRA_PROJECT_KEY, 10);
}
