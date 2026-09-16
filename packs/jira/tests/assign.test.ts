import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  assignJiraIssue,
  unassignJiraIssue,
  validateJiraAssignIssueInput,
} from "../src/index.js";
import { json, noContent, restClient, signal } from "./support/jira.js";

function assignee(name: string | null): unknown {
  return {
    id: 1,
    key: "ABC-1",
    fields: { assignee: name === null ? null : { name, displayName: name } },
  };
}

describe("Jira approved assignment actions", () => {
  it("assigns one exact username and confirms it", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(assignee(null)))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(assignee("jdoe")));

    await expect(
      assignJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", assignee: "jdoe" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "assigned",
      issueKey: "ABC-1",
      assignee: "jdoe",
    });

    const [url, init] = fetchRequest.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/rest\/api\/2\/issue\/ABC-1\/assignee$/u);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ name: "jdoe" });
  });

  it("treats an unchanged assignee as a no-op", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(assignee("jdoe")));

    await expect(
      assignJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", assignee: "jdoe" },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "already_assigned" });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("clears an assignee with an explicit null name", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(assignee("jdoe")))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(assignee(null)));

    await expect(
      unassignJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "unassigned",
      issueKey: "ABC-1",
    });
    const [, init] = fetchRequest.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ name: null });
  });

  it("treats an already empty assignee as a no-op", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(assignee(null)));

    await expect(
      unassignJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "already_unassigned" });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfirmed assignment rather than failing the write", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(assignee(null)))
      .mockResolvedValueOnce(noContent())
      .mockRejectedValueOnce(new Error("offline"));

    await expect(
      assignJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", assignee: "jdoe" },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "assigned_unconfirmed" });
  });

  it("has no sentinel that a real username could collide with", () => {
    expect(
      validateJiraAssignIssueInput({
        issueKey: "ABC-1",
        assignee: "unassigned",
      }).assignee,
    ).toBe("unassigned");
    expect(() =>
      validateJiraAssignIssueInput({ issueKey: "ABC-1", assignee: "" }),
    ).toThrow(JiraPackError);
  });
});
