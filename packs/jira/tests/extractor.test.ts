import { describe, expect, it } from "vitest";

import {
  JIRA_ADD_COMMENT,
  JIRA_CREATE_ISSUE,
  JIRA_LINK_ISSUES,
  JIRA_TOOLS,
  JiraPackError,
  discoverJiraTools,
  extractJiraCurrentContext,
  inspectJiraEnvelope,
} from "../src/index.js";
import { jiraSnapshot } from "./support/jira.js";

const NONE = new Set<never>();

describe("Jira page envelope", () => {
  it("extracts the deployment base URL and page identity", () => {
    expect(
      extractJiraCurrentContext(
        jiraSnapshot({ contextPath: "/jira", pathname: "/jira/browse/ABC-1" }),
      ),
    ).toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      baseUrl: "https://jira.example.invalid/jira",
      contextPath: "/jira",
      version: "9.12.0",
      user: "jdoe",
      userDisplayName: "Jane Doe",
      issueKey: "ABC-1",
      projectKey: "ABC",
    });
  });

  it.each([
    ["another origin", { origin: "https://jira.other.invalid" }],
    ["a non-Jira application", { application: "Confluence" }],
    ["a missing application", { application: "" }],
    ["a malformed context path", { contextPath: "/a/../b" }],
    ["a path outside the context path", { contextPath: "/jira" }],
  ])("rejects %s", (_label, overrides) => {
    expect(() => inspectJiraEnvelope(jiraSnapshot(overrides))).toThrow(
      JiraPackError,
    );
  });

  it("offers every reviewed tool on a compatible page", () => {
    expect(discoverJiraTools(jiraSnapshot(), NONE)).toEqual([...JIRA_TOOLS]);
  });

  it("offers nothing on an incompatible page", () => {
    expect(
      discoverJiraTools(jiraSnapshot({ application: "Bitbucket" }), NONE),
    ).toEqual([]);
  });

  it("withdraws non-idempotent actions once they are consumed", () => {
    const consumed = new Set([
      JIRA_ADD_COMMENT,
      JIRA_CREATE_ISSUE,
      JIRA_LINK_ISSUES,
    ] as const);

    const tools = discoverJiraTools(jiraSnapshot(), consumed);

    expect(tools).not.toContain(JIRA_ADD_COMMENT);
    expect(tools).not.toContain(JIRA_CREATE_ISSUE);
    expect(tools).not.toContain(JIRA_LINK_ISSUES);
    expect(tools).toHaveLength(JIRA_TOOLS.length - 3);
  });
});
