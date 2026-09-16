import {
  JIRA_PLACEHOLDER_ORIGIN,
  createJiraRestClient,
  type JiraFetch,
  type JiraRestClient,
  type JiraSemanticSnapshot,
} from "../../src/index.js";

export const JIRA_TEST_ORIGIN: string = JIRA_PLACEHOLDER_ORIGIN;

export function signal(): AbortSignal {
  return new AbortController().signal;
}

export function jiraSnapshot(
  overrides: Partial<JiraSemanticSnapshot> = {},
): JiraSemanticSnapshot {
  return {
    origin: JIRA_TEST_ORIGIN,
    pathname: "/browse/ABC-1",
    contextPath: "",
    application: "Jira",
    version: "9.12.0",
    user: "jdoe",
    userDisplayName: "Jane Doe",
    issueKey: "ABC-1",
    projectKey: "ABC",
    ...overrides,
  };
}

export function restClient(
  fetchRequest: JiraFetch,
  contextPath = "",
): JiraRestClient {
  return createJiraRestClient(JIRA_TEST_ORIGIN, contextPath, fetchRequest);
}

export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function issueFields(
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    summary: "Broken login",
    status: { name: "In Progress", statusCategory: { name: "In Progress" } },
    issuetype: { name: "Bug" },
    project: { key: "ABC", name: "Alpha" },
    priority: { name: "High" },
    assignee: { name: "jdoe", displayName: "Jane Doe" },
    created: "2026-09-01T09:00:00.000+0000",
    updated: "2026-09-16T09:00:00.000+0000",
    ...overrides,
  };
}
