import { describe, expect, it, vi } from "vitest";

import {
  JiraPackError,
  updateJiraIssue,
  updatePayload,
  validateJiraUpdateIssueInput,
} from "../src/index.js";
import { json, noContent, restClient, signal } from "./support/jira.js";

function stored(fields: Readonly<Record<string, unknown>>): unknown {
  return { id: 1, key: "ABC-1", fields };
}

describe("Jira approved update action", () => {
  it("sets only the named fields and confirms them", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(
        json(
          stored({
            summary: "Rotate the cert",
            priority: { name: "High" },
            labels: ["ops", "security"],
          }),
        ),
      );

    await expect(
      updateJiraIssue(
        restClient(fetchRequest),
        {
          issueKey: "ABC-1",
          summary: "Rotate the cert",
          priority: "High",
          labels: ["ops", "security"],
        },
        signal(),
      ),
    ).resolves.toEqual({
      fingerprint: "jira-datacenter-rest2-v1",
      state: "confirmed",
      issueKey: "ABC-1",
      updatedFields: ["labels", "priority", "summary"],
    });

    const [url, init] = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/rest\/api\/2\/issue\/ABC-1$/u);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      fields: {
        summary: "Rotate the cert",
        priority: { name: "High" },
        labels: ["ops", "security"],
      },
    });
  });

  it("confirms a long description against the untruncated stored value", async () => {
    const description = "d".repeat(5_000);
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(stored({ description })));

    await expect(
      updateJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", description },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "confirmed" });
  });

  it("reports an unconfirmed update rather than failing the write", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(noContent())
      .mockResolvedValueOnce(json(stored({ summary: "Something else" })));

    await expect(
      updateJiraIssue(
        restClient(fetchRequest),
        { issueKey: "ABC-1", summary: "Rotate the cert" },
        signal(),
      ),
    ).resolves.toMatchObject({ state: "applied_unconfirmed" });
  });

  it("omits every field the caller did not name", () => {
    expect(
      updatePayload(
        validateJiraUpdateIssueInput({
          issueKey: "ABC-1",
          dueDate: "2026-12-01",
        }),
      ),
    ).toEqual({ fields: { duedate: "2026-12-01" } });
  });

  it.each([
    ["no field to set", { issueKey: "ABC-1" }],
    ["a raw custom field", { issueKey: "ABC-1", customfield_10001: "x" }],
    ["a raw fields map", { issueKey: "ABC-1", fields: { summary: "x" } }],
    ["a status field", { issueKey: "ABC-1", status: "Done" }],
    ["a multi-line summary", { issueKey: "ABC-1", summary: "one\ntwo" }],
    ["a malformed due date", { issueKey: "ABC-1", dueDate: "01/12/2026" }],
    ["a non-calendar due date", { issueKey: "ABC-1", dueDate: "2026-02-30" }],
  ])("rejects %s", (_label, input) => {
    expect(() => validateJiraUpdateIssueInput(input)).toThrow(JiraPackError);
  });

  it("names every set field in a stable order for the approval record", () => {
    const input = validateJiraUpdateIssueInput({
      issueKey: "ABC-1",
      summary: "s",
      description: "d",
      priority: "High",
      labels: ["a"],
      dueDate: "2026-12-01",
    });

    expect(Object.keys(updatePayload(input).fields as object)).toEqual([
      "summary",
      "description",
      "priority",
      "labels",
      "duedate",
    ]);
  });
});
