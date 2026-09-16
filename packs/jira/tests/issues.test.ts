import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  getJiraIssue,
  searchJiraIssues,
  validateJiraSearchInput,
} from "../src/index.js";
import {
  JIRA_TEST_ORIGIN,
  issueFields,
  json,
  restClient,
  signal,
} from "./support/jira.js";

describe("Jira issue reads", () => {
  it("returns one typed issue with a bounded description excerpt", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        id: 10_001,
        key: "ABC-1",
        fields: issueFields({
          reporter: { name: "asmith", displayName: "Alex Smith" },
          resolution: { name: "Done" },
          labels: ["auth", "regression"],
          created: "2026-09-01T09:00:00.000+0000",
          description: "d".repeat(5_000),
        }),
      }),
    );

    const issue = await getJiraIssue(
      restClient(fetchRequest),
      { issueKey: "ABC-1" },
      signal(),
    );

    expect(issue).toMatchObject({
      fingerprint: "jira-datacenter-rest2-v1",
      id: "10001",
      key: "ABC-1",
      summary: "Broken login",
      status: "In Progress",
      statusCategory: "In Progress",
      issueType: "Bug",
      projectKey: "ABC",
      priority: "High",
      assignee: { name: "jdoe", displayName: "Jane Doe" },
      reporter: { name: "asmith", displayName: "Alex Smith" },
      resolution: "Done",
      labels: ["auth", "regression"],
      descriptionTruncated: true,
    });
    expect(issue.description).toHaveLength(4_096);
  });

  it("requests only the reviewed field set", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json({ id: 1, key: "ABC-1", fields: issueFields() }));

    await getJiraIssue(
      restClient(fetchRequest),
      { issueKey: "ABC-1" },
      signal(),
    );

    const [url] = fetchRequest.mock.calls[0] as [string];
    expect(url.startsWith(`${JIRA_TEST_ORIGIN}/rest/api/2/issue/ABC-1?`)).toBe(
      true,
    );
    expect(new URL(url).searchParams.get("fields")).toBe(
      "summary,status,issuetype,project,priority,assignee,updated,reporter,created,labels,resolution,description",
    );
  });

  it.each([
    ["an unknown argument", { issueKey: "ABC-1", expand: "changelog" }],
    ["a malformed key", { issueKey: "abc-1" }],
    ["a missing key", {}],
  ])("rejects %s", async (_label, input) => {
    await expect(
      getJiraIssue(restClient(vi.fn()), input, signal()),
    ).rejects.toMatchObject({ reason: "invalid_arguments" });
  });

  it("bounds a JQL search and echoes its query", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        startAt: 0,
        total: 42,
        issues: [{ id: 1, key: "ABC-1", fields: issueFields() }],
      }),
    );

    const result = await searchJiraIssues(
      restClient(fetchRequest),
      { jql: "project = ABC", limit: 5 },
      signal(),
    );

    expect(result).toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      jql: "project = ABC",
      startAt: 0,
      total: 42,
      issues: [
        {
          key: "ABC-1",
          summary: "Broken login",
          status: "In Progress",
          statusCategory: "In Progress",
          issueType: "Bug",
          projectKey: "ABC",
          priority: "High",
          assignee: { name: "jdoe", displayName: "Jane Doe" },
          updated: "2026-09-16T09:00:00.000+0000",
        },
      ],
    });
    const query = new URL((fetchRequest.mock.calls[0] as [string])[0])
      .searchParams;
    expect(query.get("maxResults")).toBe("5");
    expect(query.get("validateQuery")).toBe("strict");
  });

  it("fails closed when the server returns more rows than requested", async () => {
    const issue = { id: 1, key: "ABC-1", fields: issueFields() };
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(
        json({ startAt: 0, total: 2, issues: [issue, issue] }),
      );

    await expect(
      searchJiraIssues(
        restClient(fetchRequest),
        { jql: "project = ABC", limit: 1 },
        signal(),
      ),
    ).rejects.toThrow(JiraPackError);
  });

  it("defaults paging without accepting an out-of-range page", () => {
    expect(validateJiraSearchInput({ jql: "project = ABC" })).toEqual({
      jql: "project = ABC",
      startAt: 0,
      limit: 20,
    });
    expect(() =>
      validateJiraSearchInput({ jql: "project = ABC", limit: 51 }),
    ).toThrow(JiraPackError);
  });
});
