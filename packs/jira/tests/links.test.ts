import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  linkJiraIssues,
  validateJiraLinkIssuesInput,
} from "../src/index.js";
import { json, noContent, restClient, signal } from "./support/jira.js";

const INPUT = {
  inwardIssueKey: "ABC-1",
  outwardIssueKey: "ABC-2",
  linkType: "Relates",
};

describe("Jira approved issue link action", () => {
  it("creates one link and confirms it", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(links([])))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(links([linkTo("ABC-2")])));

    await expect(
      linkJiraIssues(restClient(fetchRequest), INPUT, signal()),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "linked",
      ...INPUT,
    });
    const write = fetchRequest.mock.calls[1] as [string, RequestInit];
    expect(write[0]).toMatch(/\/rest\/api\/2\/issueLink$/u);
    expect(JSON.parse(String(write[1].body))).toEqual({
      type: { name: "Relates" },
      inwardIssue: { key: "ABC-1" },
      outwardIssue: { key: "ABC-2" },
    });
  });

  it("treats an identical existing link as a no-op", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json(links([linkTo("ABC-2")])));

    await expect(
      linkJiraIssues(restClient(fetchRequest), INPUT, signal()),
    ).resolves.toMatchObject({ state: "already_linked" });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfirmed link rather than retrying", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(links([])))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(links([])));

    await expect(
      linkJiraIssues(restClient(fetchRequest), INPUT, signal()),
    ).resolves.toMatchObject({ state: "created_unconfirmed" });
  });

  it("rejects linking an issue to itself", () => {
    expect(() =>
      validateJiraLinkIssuesInput({ ...INPUT, outwardIssueKey: "ABC-1" }),
    ).toThrow(JiraPackError);
  });
});

function links(items: readonly unknown[]): unknown {
  return { id: 1, key: "ABC-1", fields: { issuelinks: items } };
}

function linkTo(key: string): unknown {
  return {
    id: "30001",
    type: { name: "Relates", inward: "relates to", outward: "relates to" },
    outwardIssue: { key },
  };
}
