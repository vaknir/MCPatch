import { describe, expect, it, vi } from "vitest";

import {
  listJiraTransitions,
  transitionJiraIssue,
  validateJiraTransitionIssueInput,
} from "../src/index.js";
import {
  issueFields,
  json,
  noContent,
  restClient,
  signal,
} from "./support/jira.js";

const TRANSITIONS = {
  transitions: [
    {
      id: "31",
      name: "Start Progress",
      to: { name: "In Progress", statusCategory: { name: "In Progress" } },
    },
    {
      id: 41,
      name: "Done",
      to: { name: "Done", statusCategory: { name: "Complete" } },
    },
  ],
};

describe("Jira workflow transitions", () => {
  it("lists the transitions the server currently offers", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(TRANSITIONS));

    await expect(
      listJiraTransitions(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      issueKey: "ABC-1",
      transitions: [
        {
          id: "31",
          name: "Start Progress",
          to: "In Progress",
          toCategory: "In Progress",
        },
        { id: "41", name: "Done", to: "Done", toCategory: "Complete" },
      ],
    });
  });

  it("applies one offered transition and confirms the new status", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(TRANSITIONS))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(
        json({
          id: 1,
          key: "ABC-1",
          fields: issueFields({
            status: {
              name: "In Progress",
              statusCategory: { name: "In Progress" },
            },
          }),
        }),
      );

    await expect(
      transitionJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", transitionId: "31" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "confirmed",
      issueKey: "ABC-1",
      transitionId: "31",
      status: "In Progress",
    });
    const write = fetchRequest.mock.calls[1] as [string, RequestInit];
    expect(JSON.parse(String(write[1].body))).toEqual({
      transition: { id: "31" },
    });
  });

  it("refuses a transition the server does not offer without writing", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(TRANSITIONS));

    await expect(
      transitionJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", transitionId: "99" },
        signal(),
      ),
    ).rejects.toMatchObject({ reason: "unknown_transition" });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfirmed transition rather than failing the write", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(TRANSITIONS))
      .mockResolvedValueOnce(noContent())
      .mockRejectedValueOnce(new Error("offline"));

    await expect(
      transitionJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", transitionId: "41" },
        signal(),
      ),
    ).resolves.toMatchObject({
      state: "applied_unconfirmed",
      status: "Done",
    });
  });

  it("rejects a malformed transition identifier", () => {
    expect(() =>
      validateJiraTransitionIssueInput({
        issueKey: "ABC-1",
        transitionId: "31; DROP",
      }),
    ).toThrow();
  });
});
