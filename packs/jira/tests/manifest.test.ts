import { verifyPackFixtures } from "@mcpatch/sdk";
import { describe, expect, it } from "vitest";

import {
  JIRA_ADD_COMMENT,
  JIRA_ASSIGN_ISSUE,
  JIRA_CREATE_ISSUE,
  JIRA_CURRENT_CONTEXT,
  JIRA_GET_ISSUE,
  JIRA_LINK_ISSUES,
  JIRA_LIST_COMMENTS,
  JIRA_LIST_ISSUE_LINKS,
  JIRA_LIST_PROJECTS,
  JIRA_LIST_TRANSITIONS,
  JIRA_REMOVE_ISSUE_LINK,
  JIRA_ORIGIN_PLACEHOLDER,
  JIRA_SEARCH_ISSUES,
  JIRA_TOOLS,
  JIRA_TRANSITION_ISSUE,
  JIRA_UNASSIGN_ISSUE,
  JIRA_UPDATE_ISSUE,
  jiraPack,
} from "../src/index.js";

const READ_TOOLS = [
  JIRA_CURRENT_CONTEXT,
  JIRA_GET_ISSUE,
  JIRA_SEARCH_ISSUES,
  JIRA_LIST_PROJECTS,
  JIRA_LIST_COMMENTS,
  JIRA_LIST_TRANSITIONS,
  JIRA_LIST_ISSUE_LINKS,
];
const ACTION_TOOLS = [
  JIRA_ADD_COMMENT,
  JIRA_TRANSITION_ISSUE,
  JIRA_CREATE_ISSUE,
  JIRA_LINK_ISSUES,
  JIRA_UPDATE_ISSUE,
  JIRA_ASSIGN_ISSUE,
  JIRA_UNASSIGN_ISSUE,
  JIRA_REMOVE_ISSUE_LINK,
];

describe("Jira reviewed pack manifest", () => {
  it("declares a synthetic placeholder rather than a real origin", () => {
    expect(jiraPack.manifest.matches).toEqual([
      {
        origin: JIRA_ORIGIN_PLACEHOLDER,
        paths: [{ kind: "prefix", path: "/" }],
      },
    ]);
    expect(JIRA_ORIGIN_PLACEHOLDER.endsWith(".invalid")).toBe(true);
  });

  it("requests no extension network authority", () => {
    expect(jiraPack.manifest.networkPolicy).toEqual({
      extensionRequests: "none",
    });
  });

  it("keeps every read tool at READ and every action tool at ACTION", () => {
    const tools = new Map(
      jiraPack.manifest.tools.map((tool) => [tool.name, tool]),
    );
    expect([...tools.keys()].sort()).toEqual([...JIRA_TOOLS].sort());
    for (const name of READ_TOOLS) {
      expect(tools.get(name)).toMatchObject({
        risk: "read",
        permissions: ["READ"],
      });
    }
    for (const name of ACTION_TOOLS) {
      expect(tools.get(name)).toMatchObject({
        risk: "action",
        permissions: ["ACTION"],
      });
    }
  });

  it("closes every tool input schema", () => {
    for (const tool of jiraPack.manifest.tools) {
      expect(tool.inputSchema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(tool.outputSchema).toMatchObject({
        additionalProperties: false,
      });
    }
  });

  it("keeps every service-worker handler fail closed", async () => {
    const result = await verifyPackFixtures(jiraPack, {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 2,
      allowedPermissions: ["READ", "ACTION"],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.passed).toBe(true);
    expect(result.evidence.summary).toEqual({
      total: JIRA_TOOLS.length,
      passed: JIRA_TOOLS.length,
      failed: 0,
      skipped: 0,
    });
  });
});
