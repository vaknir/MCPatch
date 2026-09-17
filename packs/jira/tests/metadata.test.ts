import { describe, expect, it, vi } from "vitest";

import {
  createJiraVersion,
  getJiraUser,
  listJiraAttachments,
  listJiraIssueLinkTypes,
  listJiraVersions,
} from "../src/index.js";
import { json, restClient, signal } from "./support/jira.js";

describe("Jira metadata reads", () => {
  it("lists issue link types so a link action can name an exact one", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        issueLinkTypes: [
          {
            id: "10000",
            name: "Blocks",
            inward: "is blocked by",
            outward: "blocks",
          },
        ],
      }),
    );

    await expect(
      listJiraIssueLinkTypes(restClient(fetchRequest), {}, signal()),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      linkTypes: [
        {
          id: "10000",
          name: "Blocks",
          inward: "is blocked by",
          outward: "blocks",
        },
      ],
    });
  });

  it("returns a user's identity without email or group data", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        name: "jdoe",
        displayName: "Jane Doe",
        active: true,
        emailAddress: "jane@example.com",
        groups: { items: [{ name: "admins" }] },
      }),
    );

    const user = await getJiraUser(
      restClient(fetchRequest),
      { username: "jdoe" },
      signal(),
    );

    expect(user).toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      name: "jdoe",
      displayName: "Jane Doe",
      active: true,
    });
    expect(JSON.stringify(user)).not.toContain("example.com");
    expect(JSON.stringify(user)).not.toContain("admins");
  });

  it("reports attachment metadata without any content transfer", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json({
        id: 1,
        key: "ABC-1",
        fields: {
          attachment: [
            {
              id: "60001",
              filename: "trace.log",
              mimeType: "text/plain",
              size: 2_048,
              created: "2026-09-16T09:00:00.000+0000",
              author: { name: "jdoe", displayName: "Jane Doe" },
              content:
                "https://jira.example.invalid/secure/attachment/60001/trace.log",
            },
          ],
        },
      }),
    );

    const result = await listJiraAttachments(
      restClient(fetchRequest),
      { issueKey: "ABC-1" },
      signal(),
    );

    expect(result.attachments).toEqual([
      {
        id: "60001",
        filename: "trace.log",
        mimeType: "text/plain",
        sizeBytes: 2_048,
        created: "2026-09-16T09:00:00.000+0000",
        author: { name: "jdoe", displayName: "Jane Doe" },
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("secure/attachment");
  });

  it("returns an empty list for an issue with no attachments", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json({ id: 1, key: "ABC-1", fields: {} }));

    await expect(
      listJiraAttachments(
        restClient(fetchRequest),
        { issueKey: "ABC-1" },
        signal(),
      ),
    ).resolves.toMatchObject({ attachments: [] });
  });
});

describe("Jira version tools", () => {
  it("bounds a project's versions", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(
      json([
        { id: "70001", name: "1.0.0", released: true, archived: false },
        { id: "70002", name: "1.1.0", released: false, archived: false },
      ]),
    );

    await expect(
      listJiraVersions(
        restClient(fetchRequest),
        { projectKey: "ABC", limit: 1 },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      projectKey: "ABC",
      versions: [
        { id: "70001", name: "1.0.0", released: true, archived: false },
      ],
    });
  });

  it("creates one version from named bounded fields", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(json({ id: "70003", name: "1.2.0" }, 201));

    await expect(
      createJiraVersion(
        restClient(fetchRequest),
        { projectKey: "ABC", name: "1.2.0", releaseDate: "2026-12-01" },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "created",
      projectKey: "ABC",
      versionId: "70003",
      name: "1.2.0",
    });
    const [, init] = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      project: "ABC",
      name: "1.2.0",
      releaseDate: "2026-12-01",
    });
  });
});
