import { MCPatch } from "@mcpatch/sdk/browser";
import type { MCPatchDefinition } from "@mcpatch/sdk/runtime";

import { JIRA_SITE_ORIGINS } from "./deployment.js";
import { createJiraDocumentSource } from "./document-source.js";
import {
  JIRA_ADD_COMMENT,
  JIRA_CREATE_ISSUE,
  JIRA_CURRENT_CONTEXT,
  JIRA_FINGERPRINT,
  JIRA_GET_ISSUE,
  JIRA_LINK_ISSUES,
  JIRA_LIST_COMMENTS,
  JIRA_LIST_PROJECTS,
  JIRA_LIST_TRANSITIONS,
  JIRA_SEARCH_ISSUES,
  JIRA_TRANSITION_ISSUE,
} from "./model.js";
import { createJiraSite, type JiraSite } from "./site.js";
import {
  JIRA_MAX_JQL_LENGTH,
  JIRA_MAX_LABELS,
  JIRA_MAX_NAME_LENGTH,
  JIRA_MAX_PAGE_SIZE,
  JIRA_MAX_START_AT,
  JIRA_MAX_SUMMARY_LENGTH,
  JIRA_MAX_TEXT_LENGTH,
} from "./validation.js";

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
  properties: {},
} as const;

const ISSUE_KEY_SCHEMA = {
  type: "string",
  minLength: 3,
  maxLength: 21,
} as const;
const PROJECT_KEY_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 10,
} as const;
const NAME_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: JIRA_MAX_NAME_LENGTH,
} as const;
const LIMIT_SCHEMA = {
  type: "integer",
  minimum: 1,
  maximum: JIRA_MAX_PAGE_SIZE,
} as const;

const ISSUE_KEY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  maxProperties: 1,
  required: ["issueKey"],
  properties: { issueKey: ISSUE_KEY_SCHEMA },
} as const;

const USER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "displayName"],
  properties: {
    name: { type: "string" },
    displayName: { type: "string" },
  },
} as const;

const ISSUE_SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "key",
    "summary",
    "status",
    "statusCategory",
    "issueType",
    "projectKey",
    "updated",
  ],
  properties: {
    key: { type: "string" },
    summary: { type: "string" },
    status: { type: "string" },
    statusCategory: { type: "string" },
    issueType: { type: "string" },
    projectKey: { type: "string" },
    priority: { type: "string" },
    assignee: USER_SCHEMA,
    updated: { type: "string" },
  },
} as const;

const mcp = new MCPatch<JiraSite>({
  publisher: "jira",
  id: "jira-data-center",
  name: "Jira Data Center",
  description:
    "Expose bounded Jira Data Center issue, project, comment, and workflow reads plus approved comment, transition, create, and link actions from an authenticated browser session.",
  version: "0.1.0",
  // Reviewed manifest identity; enforced by tests/digest.test.ts.
  digest:
    "sha256:3ad6ed5dc73f679892b2923c3e06158c51a24e2b2d367ce18c080751a9e7a2c3",
  matches: JIRA_SITE_ORIGINS.map((origin) => ({
    origin,
    paths: [{ kind: "prefix", path: "/" }] as const,
  })),
});

mcp.tool(
  {
    name: JIRA_CURRENT_CONTEXT,
    description:
      "Read the enabled Jira Data Center base URL, product version, signed-in user, and the issue or project the current page is showing.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "baseUrl", "contextPath"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        baseUrl: { type: "string" },
        contextPath: { type: "string" },
        version: { type: "string" },
        user: { type: "string" },
        userDisplayName: { type: "string" },
        issueKey: { type: "string" },
        projectKey: { type: "string" },
      },
    },
  },
  (_input, { site, signal }) => site.currentContext(signal),
);

mcp.tool(
  {
    name: JIRA_GET_ISSUE,
    description:
      "Read one Jira issue by exact key with its status, type, project, people, labels, timestamps, and a bounded description excerpt.",
    risk: "read",
    inputSchema: ISSUE_KEY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "fingerprint",
        "id",
        "key",
        "summary",
        "status",
        "statusCategory",
        "issueType",
        "projectKey",
        "labels",
        "created",
        "updated",
        "descriptionTruncated",
      ],
      properties: {
        ...ISSUE_SUMMARY_SCHEMA.properties,
        fingerprint: { const: JIRA_FINGERPRINT },
        id: { type: "string" },
        reporter: USER_SCHEMA,
        resolution: { type: "string" },
        labels: { type: "array", maxItems: 64, items: { type: "string" } },
        created: { type: "string" },
        description: { type: "string" },
        descriptionTruncated: { type: "boolean" },
      },
    },
  },
  (input, { site, signal }) => site.getIssue(input, signal),
);

mcp.tool(
  {
    name: JIRA_SEARCH_ISSUES,
    description:
      "Run one bounded read-only JQL query and return at most 50 matching issues as typed summaries without raw Jira response data.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 3,
      required: ["jql"],
      properties: {
        jql: { type: "string", minLength: 1, maxLength: JIRA_MAX_JQL_LENGTH },
        startAt: { type: "integer", minimum: 0, maximum: JIRA_MAX_START_AT },
        limit: LIMIT_SCHEMA,
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "jql", "startAt", "total", "issues"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        jql: { type: "string" },
        startAt: { type: "integer" },
        total: { type: "integer" },
        issues: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: ISSUE_SUMMARY_SCHEMA,
        },
      },
    },
  },
  (input, { site, signal }) => site.searchIssues(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_PROJECTS,
    description:
      "List at most 50 Jira projects the signed-in user can see, optionally narrowed by a bounded key or name substring.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      properties: { query: NAME_SCHEMA, limit: LIMIT_SCHEMA },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "projects"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        projects: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["key", "name"],
            properties: {
              key: { type: "string" },
              name: { type: "string" },
              projectTypeKey: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listProjects(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_COMMENTS,
    description:
      "Read at most 50 comments of one Jira issue with author identity, timestamps, and a bounded body excerpt.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["issueKey"],
      properties: { issueKey: ISSUE_KEY_SCHEMA, limit: LIMIT_SCHEMA },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "issueKey", "total", "comments"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        issueKey: { type: "string" },
        total: { type: "integer" },
        comments: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "created", "updated", "body", "bodyTruncated"],
            properties: {
              id: { type: "string" },
              author: USER_SCHEMA,
              created: { type: "string" },
              updated: { type: "string" },
              body: { type: "string" },
              bodyTruncated: { type: "boolean" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listComments(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_TRANSITIONS,
    description:
      "Read the workflow transitions the signed-in user may currently apply to one Jira issue, including each target status.",
    risk: "read",
    inputSchema: ISSUE_KEY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "issueKey", "transitions"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        issueKey: { type: "string" },
        transitions: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "to", "toCategory"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              to: { type: "string" },
              toCategory: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listTransitions(input, signal),
);

mcp.tool(
  {
    name: JIRA_ADD_COMMENT,
    description:
      "Add one bounded plain-text comment to one exact Jira issue after one-time approval and confirm the stored comment identity.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["issueKey", "body"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
        body: { type: "string", minLength: 1, maxLength: JIRA_MAX_TEXT_LENGTH },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "issueKey", "commentId", "created"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { const: "added" },
        issueKey: { type: "string" },
        commentId: { type: "string" },
        created: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.addComment(input, signal),
);

mcp.tool(
  {
    name: JIRA_TRANSITION_ISSUE,
    description:
      "Apply one currently offered workflow transition to one exact Jira issue after one-time approval and confirm the resulting status.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["issueKey", "transitionId"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
        transitionId: { type: "string", minLength: 1, maxLength: 19 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "issueKey", "transitionId", "status"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { enum: ["applied_unconfirmed", "confirmed"] },
        issueKey: { type: "string" },
        transitionId: { type: "string" },
        status: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.transitionIssue(input, signal),
);

mcp.tool(
  {
    name: JIRA_CREATE_ISSUE,
    description:
      "Create one Jira issue from an exact project key, issue type, summary, and optional description and labels after one-time approval.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 5,
      required: ["projectKey", "issueType", "summary"],
      properties: {
        projectKey: PROJECT_KEY_SCHEMA,
        issueType: NAME_SCHEMA,
        summary: {
          type: "string",
          minLength: 1,
          maxLength: JIRA_MAX_SUMMARY_LENGTH,
        },
        description: {
          type: "string",
          minLength: 1,
          maxLength: JIRA_MAX_TEXT_LENGTH,
        },
        labels: {
          type: "array",
          maxItems: JIRA_MAX_LABELS,
          items: { type: "string", minLength: 1, maxLength: 255 },
        },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "fingerprint",
        "state",
        "issueKey",
        "id",
        "projectKey",
        "issueType",
      ],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { const: "created" },
        issueKey: { type: "string" },
        id: { type: "string" },
        projectKey: { type: "string" },
        issueType: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.createIssue(input, signal),
);

mcp.tool(
  {
    name: JIRA_LINK_ISSUES,
    description:
      "Link two exact existing Jira issues with one named link type after one-time approval, treating an identical existing link as a no-op.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 3,
      required: ["inwardIssueKey", "outwardIssueKey", "linkType"],
      properties: {
        inwardIssueKey: ISSUE_KEY_SCHEMA,
        outwardIssueKey: ISSUE_KEY_SCHEMA,
        linkType: NAME_SCHEMA,
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "fingerprint",
        "state",
        "inwardIssueKey",
        "outwardIssueKey",
        "linkType",
      ],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: {
          enum: ["already_linked", "created_unconfirmed", "linked"],
        },
        inwardIssueKey: { type: "string" },
        outwardIssueKey: { type: "string" },
        linkType: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.linkIssues(input, signal),
);

export const jiraBrowserPack = mcp.build({
  fixtures: [
    {
      id: "page-only-current-context",
      tool: JIRA_CURRENT_CONTEXT,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-get-issue",
      tool: JIRA_GET_ISSUE,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-search-issues",
      tool: JIRA_SEARCH_ISSUES,
      input: { jql: "project = ABC ORDER BY created DESC", limit: 5 },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-projects",
      tool: JIRA_LIST_PROJECTS,
      input: { limit: 5 },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-comments",
      tool: JIRA_LIST_COMMENTS,
      input: { issueKey: "ABC-1", limit: 5 },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-transitions",
      tool: JIRA_LIST_TRANSITIONS,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-add-comment",
      tool: JIRA_ADD_COMMENT,
      input: { issueKey: "ABC-1", body: "Reviewed." },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-transition-issue",
      tool: JIRA_TRANSITION_ISSUE,
      input: { issueKey: "ABC-1", transitionId: "31" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-create-issue",
      tool: JIRA_CREATE_ISSUE,
      input: { projectKey: "ABC", issueType: "Task", summary: "Example" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-link-issues",
      tool: JIRA_LINK_ISSUES,
      input: {
        inwardIssueKey: "ABC-1",
        outwardIssueKey: "ABC-2",
        linkType: "Relates",
      },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
  ],
  create: (document) => createJiraSite(createJiraDocumentSource(document)),
  discover: ({ site, signal }) => site.capabilities(signal),
  subscribe: (site, listener) => site.subscribe(listener),
});

export const jiraPack: MCPatchDefinition = jiraBrowserPack.definition;
