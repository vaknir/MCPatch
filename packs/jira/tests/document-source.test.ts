import { describe, expect, it } from "vitest";

import { collectJiraSemanticSnapshot } from "../src/index.js";
import { JIRA_TEST_ORIGIN, signal } from "./support/jira.js";

describe("Jira document source", () => {
  it("collects only Jira's own bounded ajs metadata", () => {
    const snapshot = collectJiraSemanticSnapshot(jiraDocument(), signal());

    expect(snapshot).toEqual({
      origin: JIRA_TEST_ORIGIN,
      pathname: "/jira/browse/ABC-1",
      contextPath: "/jira",
      application: "Jira",
      version: "9.12.0",
      user: "jdoe",
      userDisplayName: "Jane Doe",
      issueKey: "ABC-1",
      projectKey: "ABC",
    });
  });

  it("omits an issue or project key the page reports malformed", () => {
    const snapshot = collectJiraSemanticSnapshot(
      jiraDocument({ "issue-key": "abc 1", "project-key": "not a key" }),
      signal(),
    );

    expect(snapshot.issueKey).toBeUndefined();
    expect(snapshot.projectKey).toBeUndefined();
  });

  it("keeps a malformed context path verbatim so inspection fails closed", () => {
    const snapshot = collectJiraSemanticSnapshot(
      jiraDocument({ "context-path": "/a/../b" }),
      signal(),
    );

    expect(snapshot.contextPath).toBe("/a/../b");
  });

  it("ignores an oversized metadata value", () => {
    const snapshot = collectJiraSemanticSnapshot(
      jiraDocument({ "app-title": "J".repeat(257) }),
      signal(),
    );

    expect(snapshot.application).toBe("");
  });

  it("rejects a value that is not a document", () => {
    expect(() =>
      collectJiraSemanticSnapshot({} as unknown as Document, signal()),
    ).toThrow(TypeError);
  });
});

function jiraDocument(
  overrides: Readonly<Record<string, string>> = {},
): Document {
  const meta: Record<string, string> = {
    "context-path": "/jira",
    "app-title": "Jira",
    "version-number": "9.12.0",
    "remote-user": "jdoe",
    "remote-user-fullname": "Jane Doe",
    "issue-key": "ABC-1",
    "project-key": "ABC",
    ...overrides,
  };
  return {
    nodeType: 9,
    location: { origin: JIRA_TEST_ORIGIN, pathname: "/jira/browse/ABC-1" },
    querySelector(selector: string) {
      const name = /^head meta\[name="ajs-(?<name>[a-z-]+)"\]$/u.exec(selector)
        ?.groups?.["name"];
      const content = name === undefined ? undefined : meta[name];
      return content === undefined
        ? null
        : ({ getAttribute: () => content } as unknown as Element);
    },
  } as unknown as Document;
}
