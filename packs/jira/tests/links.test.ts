import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  linkJiraIssues,
  listJiraIssueLinks,
  removeJiraIssueLink,
  validateJiraLinkIssuesInput,
  validateJiraRemoveIssueLinkInput,
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

describe("Jira issue link reads", () => {
  it("returns each link's exact id, type, and direction", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(
        json(links([linkTo("ABC-2"), linkFrom("ABC-9", "40002")])),
      );

    await expect(
      listJiraIssueLinks(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      issueKey: "ABC-1",
      links: [
        {
          id: "30001",
          type: "Relates",
          direction: "outward",
          otherIssueKey: "ABC-2",
        },
        {
          id: "40002",
          type: "Blocks",
          direction: "inward",
          otherIssueKey: "ABC-9",
        },
      ],
    });
  });
});

describe("Jira approved issue link removal", () => {
  it("removes one link by exact id and confirms it", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(links([linkTo("ABC-2")])))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(links([])));

    await expect(
      removeJiraIssueLink(
        restClient(fetchRequest),
        { issueKey: "ABC-1", linkId: "30001" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "removed",
      issueKey: "ABC-1",
      linkId: "30001",
    });
    const [url, init] = fetchRequest.mock.calls[1] as [string, RequestInit];
    expect(url).toMatch(/\/rest\/api\/2\/issueLink\/30001$/u);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("refuses a link id that is not on the approved issue", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json(links([linkTo("ABC-2")])));

    await expect(
      removeJiraIssueLink(
        restClient(fetchRequest),
        { issueKey: "ABC-1", linkId: "99999" },
        signal(),
      ),
    ).rejects.toMatchObject({ reason: "unknown_issue_link" });
    expect(fetchRequest).toHaveBeenCalledTimes(1);
  });

  it("reports an unconfirmed removal rather than retrying", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json(links([linkTo("ABC-2")])))
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(links([linkTo("ABC-2")])));

    await expect(
      removeJiraIssueLink(
        restClient(fetchRequest),
        { issueKey: "ABC-1", linkId: "30001" },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "removed_unconfirmed" });
  });

  it("rejects a malformed link id", () => {
    expect(() =>
      validateJiraRemoveIssueLinkInput({
        issueKey: "ABC-1",
        linkId: "30001/../../x",
      }),
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

function linkFrom(key: string, id: string): unknown {
  return {
    id,
    type: { name: "Blocks", inward: "is blocked by", outward: "blocks" },
    inwardIssue: { key },
  };
}
