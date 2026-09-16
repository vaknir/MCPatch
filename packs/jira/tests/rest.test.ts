import { describe, expect, it, vi } from "vitest";

import { JiraPackError } from "../src/index.js";
import {
  JIRA_TEST_ORIGIN,
  json,
  noContent,
  restClient,
  signal,
} from "./support/jira.js";

describe("Jira REST client", () => {
  it("issues one credentialed same-origin GET under the fixed REST prefix", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json({ ok: true }));

    await restClient(fetchRequest, "/jira").get(
      "/issue/ABC-1",
      { fields: "status" },
      signal(),
    );

    const [url, init] = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${JIRA_TEST_ORIGIN}/jira/rest/api/2/issue/ABC-1?fields=status`,
    );
    expect(init).toMatchObject({
      method: "GET",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
    });
    expect(init.headers).toEqual({ Accept: "application/json" });
  });

  it("sends only a serialized JSON body on a POST", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json({ id: "1" }, 201));

    await restClient(fetchRequest).post("/issue", { fields: {} }, signal());

    const [url, init] = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${JIRA_TEST_ORIGIN}/rest/api/2/issue`);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Atlassian-Token": "no-check",
    });
    expect(JSON.parse(String(init.body))).toEqual({ fields: {} });
  });

  it("accepts an empty write response", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(noContent());

    await expect(
      restClient(fetchRequest).post("/issueLink", {}, signal()),
    ).resolves.toBeUndefined();
  });

  it.each([
    ["a failed status", () => json({}, 500)],
    ["a redirect", () => Response.error()],
    [
      "a non-JSON body",
      () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
    ],
    [
      "an oversized body",
      () =>
        new Response("x".repeat(600 * 1024), {
          headers: { "content-type": "application/json" },
        }),
    ],
  ])("fails closed on %s", async (_label, respond) => {
    const fetchRequest = vi.fn().mockResolvedValue(respond());

    await expect(
      restClient(fetchRequest).get("/myself", {}, signal()),
    ).rejects.toThrow(JiraPackError);
  });

  it("never leaves the enabled origin", async () => {
    const fetchRequest = vi.fn().mockResolvedValue(json({}));

    await expect(
      restClient(fetchRequest).get("/issue/../../../evil", {}, signal()),
    ).rejects.toThrow(JiraPackError);
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("cancels before contacting the site", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchRequest = vi.fn();

    await expect(
      restClient(fetchRequest).get("/myself", {}, controller.signal),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetchRequest).not.toHaveBeenCalled();
  });
});
