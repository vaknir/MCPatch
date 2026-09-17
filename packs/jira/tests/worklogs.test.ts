import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  addJiraWorklog,
  listJiraWorklogs,
  toJiraInstant,
  validateJiraAddWorklogInput,
} from "../src/index.js";
import { json, restClient, signal } from "./support/jira.js";

const WORKLOG = {
  id: 50_001,
  author: { name: "jdoe", displayName: "Jane Doe" },
  started: "2026-09-16T09:00:00.000+0000",
  timeSpent: "2h 30m",
  timeSpentSeconds: 9_000,
  comment: "Paired on the fix.",
};

describe("Jira worklog reads", () => {
  it("returns bounded typed worklog entries", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json({ total: 1, worklogs: [WORKLOG] }));

    await expect(
      listJiraWorklogs(
        restClient(fetchRequest),
        { issueKey: "ABC-1", limit: 5 },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      issueKey: "ABC-1",
      total: 1,
      worklogs: [
        {
          id: "50001",
          author: { name: "jdoe", displayName: "Jane Doe" },
          started: "2026-09-16T09:00:00.000+0000",
          timeSpent: "2h 30m",
          timeSpentSeconds: 9_000,
          comment: "Paired on the fix.",
        },
      ],
    });
  });
});

describe("Jira approved worklog action", () => {
  it("logs one bounded duration and returns the stored entry", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(WORKLOG, 201));

    await expect(
      addJiraWorklog(
        restClient(fetchRequest),
        {
          issueKey: "ABC-1",
          timeSpent: "2h 30m",
          startedAt: "2026-09-16T09:00:00.000Z",
          comment: "Paired on the fix.",
        },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "added",
      issueKey: "ABC-1",
      worklogId: "50001",
      timeSpent: "2h 30m",
      timeSpentSeconds: 9_000,
    });

    const [url, init] = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/rest\/api\/2\/issue\/ABC-1\/worklog$/u);
    expect(JSON.parse(String(init.body))).toEqual({
      timeSpent: "2h 30m",
      started: "2026-09-16T09:00:00.000+0000",
      comment: "Paired on the fix.",
    });
  });

  it("converts an ISO instant to Jira's offset form", () => {
    expect(toJiraInstant("2026-09-16T09:00:00.000Z")).toBe(
      "2026-09-16T09:00:00.000+0000",
    );
  });

  it.each([
    ["a free-form duration", { issueKey: "ABC-1", timeSpent: "about a day" }],
    ["a negative duration", { issueKey: "ABC-1", timeSpent: "-2h" }],
    [
      "a remaining-estimate field",
      {
        issueKey: "ABC-1",
        timeSpent: "2h",
        remainingEstimate: "0m",
      },
    ],
    [
      "a non-UTC start time",
      {
        issueKey: "ABC-1",
        timeSpent: "2h",
        startedAt: "2026-09-16T09:00:00+0200",
      },
    ],
    [
      "a non-calendar start time",
      {
        issueKey: "ABC-1",
        timeSpent: "2h",
        startedAt: "2026-02-30T09:00:00.000Z",
      },
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => validateJiraAddWorklogInput(input)).toThrow(JiraPackError);
  });

  it("accepts Jira's own duration grammar", () => {
    expect(
      validateJiraAddWorklogInput({ issueKey: "ABC-1", timeSpent: "1d 4h 30m" })
        .timeSpent,
    ).toBe("1d 4h 30m");
  });
});
