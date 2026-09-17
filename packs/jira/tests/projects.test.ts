import { describe, expect, it, vi } from "vitest";

import { JiraPackError, listJiraProjects } from "../src/index.js";
import { json, restClient, signal } from "./support/jira.js";

const PROJECTS = [
  { key: "ABC", name: "Alpha Billing", projectTypeKey: "software" },
  { key: "OPS", name: "Operations" },
  { key: "SUP", name: "Support Desk", projectTypeKey: "service_desk" },
];

describe("Jira project reads", () => {
  it("returns bounded typed projects", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(PROJECTS));

    await expect(
      listJiraProjects(restClient(fetchRequest), { limit: 2 }, signal()),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      projects: [
        { key: "ABC", name: "Alpha Billing", projectTypeKey: "software" },
        { key: "OPS", name: "Operations" },
      ],
    });
  });

  it("narrows by a case-insensitive key or name substring", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json(PROJECTS));

    const result = await listJiraProjects(
      restClient(fetchRequest),
      { query: "desk" },
      signal(),
    );

    expect(result.projects).toEqual([
      { key: "SUP", name: "Support Desk", projectTypeKey: "service_desk" },
    ]);
  });

  it("fails closed on a malformed project key", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json([{ key: "not a key", name: "Broken" }]));

    await expect(
      listJiraProjects(restClient(fetchRequest), {}, signal()),
    ).rejects.toThrow(JiraPackError);
  });

  it("rejects an unknown argument", async () => {
    await expect(
      listJiraProjects(restClient(vi.fn()), { expand: "lead" }, signal()),
    ).rejects.toMatchObject({ reason: "invalid_arguments" });
  });
});
