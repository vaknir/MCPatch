import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  deleteJiraIssue,
  validateJiraDeleteIssueInput,
} from "../src/index.js";
import { json, noContent, restClient, signal } from "./support/jira.js";

function target(subtasks: readonly unknown[]): unknown {
  return { id: 1, key: "ABC-1", fields: { summary: "Broken login", subtasks } };
}

describe("Jira approved delete action", () => {
  it("reports the summary it destroyed", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(target([])))
      .mockResolvedValueOnce(noContent());

    await expect(
      deleteJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "deleted",
      issueKey: "ABC-1",
      summary: "Broken login",
      deletedSubtasks: 0,
    });

    const [url, init] = fetchRequest.mock.calls[1] as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(new URL(url).searchParams.get("deleteSubtasks")).toBe("false");
  });

  it("refuses to cascade into subtasks unless asked", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json(target([{ id: "2" }, { id: "3" }])));

    await expect(
      deleteJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).rejects.toMatchObject({ reason: "subtasks_present" });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("cascades only on an explicit opt-in and counts what went with it", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(target([{ id: "2" }, { id: "3" }])))
      .mockResolvedValueOnce(noContent());

    await expect(
      deleteJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", deleteSubtasks: true },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "deleted", deletedSubtasks: 2 });
    const [url] = fetchRequest.mock.calls[1] as [string];
    expect(new URL(url).searchParams.get("deleteSubtasks")).toBe("true");
  });

  it("does not delete an issue it could not read first", async () => {
    const fetchRequest = vi.fn().mockRejectedValue(new Error("not found"));

    await expect(
      deleteJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).rejects.toThrow(JiraPackError);
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-boolean cascade flag", () => {
    expect(() =>
      validateJiraDeleteIssueInput({
        issueKey: "ABC-1",
        deleteSubtasks: "yes",
      }),
    ).toThrow(JiraPackError);
  });
});
