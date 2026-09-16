import { describe, expect, it, vi } from "vitest";

import {
  JIRA_ADD_COMMENT,
  JIRA_TOOLS,
  createJiraSite,
  type JiraFetch,
  type JiraSite,
  type JiraSnapshotSource,
} from "../src/index.js";
import { jiraSnapshot, json, restClient, signal } from "./support/jira.js";

describe("Jira site lifecycle", () => {
  it("publishes every reviewed tool on a compatible page", async () => {
    const { site } = createSite(vi.fn());

    await expect(site.capabilities(signal())).resolves.toEqual([...JIRA_TOOLS]);
  });

  it("refuses every tool on a page that is not the enabled Jira site", async () => {
    const { site } = createSite(vi.fn(), {
      origin: "https://other.example.invalid",
    });

    await expect(site.capabilities(signal())).resolves.toEqual([]);
    await expect(
      site.getIssue({ issueKey: "ABC-1" }, signal()),
    ).rejects.toMatchObject({ reason: "unsupported_origin" });
  });

  it("consumes a non-idempotent action once per document context", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(
        json({ id: "1", created: "2026-09-16T10:00:00.000+0000" }, 201),
      );
    const { site } = createSite(fetchRequest);

    await expect(
      site.addComment({ issueKey: "ABC-1", body: "Once." }, signal()),
    ).resolves.toMatchObject({ state: "added" });
    await expect(
      site.addComment({ issueKey: "ABC-1", body: "Twice." }, signal()),
    ).rejects.toMatchObject({ reason: "action_already_started" });
    expect(await site.capabilities(signal())).not.toContain(JIRA_ADD_COMMENT);
  });

  it("does not consume an action rejected for invalid arguments", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValue(
        json({ id: "1", created: "2026-09-16T10:00:00.000+0000" }, 201),
      );
    const { site } = createSite(fetchRequest);

    await expect(
      site.addComment({ issueKey: "ABC-1" }, signal()),
    ).rejects.toMatchObject({ reason: "invalid_arguments" });
    await expect(
      site.addComment({ issueKey: "ABC-1", body: "Now valid." }, signal()),
    ).resolves.toMatchObject({ state: "added" });
  });

  it("notifies a subscriber only when the capability set changes", async () => {
    const listeners: (() => void)[] = [];
    const { site } = createSite(vi.fn(), {}, (listener) => {
      listeners.push(listener);
      return () => undefined;
    });
    const changed = vi.fn();

    const stop = site.subscribe(changed);
    await site.capabilities(signal());
    listeners[0]?.();
    await Promise.resolve();
    expect(changed).not.toHaveBeenCalled();
    stop();
  });

  it("rejects a source without a snapshot reader", () => {
    expect(() => createJiraSite({} as unknown as JiraSnapshotSource)).toThrow(
      TypeError,
    );
  });
});

function createSite(
  fetchRequest: JiraFetch,
  overrides: Parameters<typeof jiraSnapshot>[0] = {},
  subscribe?: (listener: () => void) => () => void,
): { readonly site: JiraSite } {
  const source: JiraSnapshotSource = {
    read: () => jiraSnapshot(overrides),
    client: () => restClient(fetchRequest),
    ...(subscribe === undefined ? {} : { subscribe }),
  };
  return { site: createJiraSite(source) };
}
