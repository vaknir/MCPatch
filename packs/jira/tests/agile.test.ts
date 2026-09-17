import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  createJiraSprint,
  listJiraBoards,
  listJiraSprintIssues,
  listJiraSprints,
  validateJiraCreateSprintInput,
} from "../src/index.js";
import {
  JIRA_TEST_ORIGIN,
  issueFields,
  json,
  restClient,
  signal,
} from "./support/jira.js";

describe("Jira agile reads", () => {
  it("reaches the agile root rather than the core REST root", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(
        json({ values: [{ id: 12, name: "Alpha board", type: "scrum" }] }),
      );

    await expect(
      listJiraBoards(restClient(fetchRequest), { limit: 5 }, signal()),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      boards: [{ id: "12", name: "Alpha board", type: "scrum" }],
    });

    const [url] = fetchRequest.mock.calls[0] as [string];
    expect(url.startsWith(`${JIRA_TEST_ORIGIN}/rest/agile/1.0/board?`)).toBe(
      true,
    );
  });

  it("narrows sprints to one exact board and state", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        values: [
          {
            id: "34",
            name: "Sprint 8",
            state: "ACTIVE",
            startDate: "2026-09-01T09:00:00.000Z",
            goal: "Ship auth",
          },
        ],
      }),
    );

    await expect(
      listJiraSprints(
        restClient(fetchRequest),
        { boardId: "12", state: "active" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      boardId: "12",
      sprints: [
        {
          id: "34",
          name: "Sprint 8",
          state: "active",
          startDate: "2026-09-01T09:00:00.000Z",
          goal: "Ship auth",
        },
      ],
    });
    const query = new URL((fetchRequest.mock.calls[0] as [string])[0])
      .searchParams;
    expect(query.get("state")).toBe("active");
  });

  it("returns sprint issues as the same typed summaries as search", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        total: 1,
        issues: [{ id: 1, key: "ABC-1", fields: issueFields() }],
      }),
    );

    const result = await listJiraSprintIssues(
      restClient(fetchRequest),
      { sprintId: "34" },
      signal(),
    );

    expect(result.issues[0]).toMatchObject({
      key: "ABC-1",
      status: "In Progress",
      issueType: "Bug",
    });
    expect(
      (fetchRequest.mock.calls[0] as [string])[0].includes(
        "/rest/agile/1.0/sprint/34/issue",
      ),
    ).toBe(true);
  });

  it("fails closed on an unknown sprint state", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(
        json({ values: [{ id: 1, name: "S", state: "odd" }] }),
      );

    await expect(
      listJiraSprints(restClient(fetchRequest), { boardId: "12" }, signal()),
    ).rejects.toThrow(JiraPackError);
  });
});

describe("Jira approved sprint creation", () => {
  it("creates one sprint on one exact board", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json({ id: 35, name: "Sprint 9" }, 201));

    await expect(
      createJiraSprint(
        restClient(fetchRequest),
        { boardId: "12", name: "Sprint 9", goal: "Ship billing" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "created",
      boardId: "12",
      sprintId: "35",
      name: "Sprint 9",
    });
    const [url, init] = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/rest\/agile\/1\.0\/sprint$/u);
    expect(JSON.parse(String(init.body))).toEqual({
      name: "Sprint 9",
      originBoardId: 12,
      goal: "Ship billing",
    });
  });

  it.each([
    ["a sprint state change", { boardId: "12", name: "S", state: "active" }],
    ["a malformed board id", { boardId: "12a", name: "S" }],
    [
      "an end date before the start date",
      {
        boardId: "12",
        name: "S",
        startDate: "2026-09-10T09:00:00.000Z",
        endDate: "2026-09-01T09:00:00.000Z",
      },
    ],
  ])("rejects %s", (_label, input) => {
    expect(() => validateJiraCreateSprintInput(input)).toThrow(JiraPackError);
  });
});
