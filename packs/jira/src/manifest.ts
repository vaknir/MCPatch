import { MCPatch } from "@mcpatch/sdk/browser";
import type { MCPatchDefinition } from "@mcpatch/sdk/runtime";

import { JIRA_SITE_ORIGINS } from "./deployment.js";
import { createJiraDocumentSource } from "./document-source.js";
import {
  JIRA_ADD_COMMENT,
  JIRA_ADD_WORKLOG,
  JIRA_ASSIGN_ISSUE,
  JIRA_CREATE_ISSUE,
  JIRA_CREATE_SPRINT,
  JIRA_CREATE_VERSION,
  JIRA_CURRENT_CONTEXT,
  JIRA_DELETE_ISSUE,
  JIRA_FINGERPRINT,
  JIRA_GET_ISSUE,
  JIRA_GET_USER,
  JIRA_LINK_ISSUES,
  JIRA_LIST_ATTACHMENTS,
  JIRA_LIST_BOARDS,
  JIRA_LIST_COMMENTS,
  JIRA_LIST_ISSUE_LINKS,
  JIRA_LIST_ISSUE_LINK_TYPES,
  JIRA_LIST_PROJECTS,
  JIRA_LIST_SPRINTS,
  JIRA_LIST_SPRINT_ISSUES,
  JIRA_LIST_TRANSITIONS,
  JIRA_LIST_VERSIONS,
  JIRA_LIST_WORKLOGS,
  JIRA_REMOVE_ISSUE_LINK,
  JIRA_SEARCH_ISSUES,
  JIRA_TRANSITION_ISSUE,
  JIRA_UNASSIGN_ISSUE,
  JIRA_UPDATE_ISSUE,
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
    "sha256:d077f6277030c6f74ab12d0a7ec49e495c3d6208682f8a3a838e4a650f947eb0",
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

mcp.tool(
  {
    name: JIRA_LIST_ISSUE_LINKS,
    description:
      "Read the links of one Jira issue with each link's exact id, type, direction, and the issue on the other side.",
    risk: "read",
    inputSchema: ISSUE_KEY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "issueKey", "links"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        issueKey: { type: "string" },
        links: {
          type: "array",
          maxItems: 256,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "type", "direction", "otherIssueKey"],
            properties: {
              id: { type: "string" },
              type: { type: "string" },
              direction: { enum: ["inward", "outward"] },
              otherIssueKey: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listIssueLinks(input, signal),
);

mcp.tool(
  {
    name: JIRA_UPDATE_ISSUE,
    description:
      "Set one or more named fields of one exact Jira issue after one-time approval, limited to summary, description, priority, labels, and due date.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 6,
      required: ["issueKey"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
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
        priority: NAME_SCHEMA,
        labels: {
          type: "array",
          maxItems: JIRA_MAX_LABELS,
          items: { type: "string", minLength: 1, maxLength: 255 },
        },
        dueDate: { type: "string", minLength: 10, maxLength: 10 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "issueKey", "updatedFields"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { enum: ["applied_unconfirmed", "confirmed"] },
        issueKey: { type: "string" },
        updatedFields: {
          type: "array",
          maxItems: 5,
          items: {
            enum: ["description", "dueDate", "labels", "priority", "summary"],
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.updateIssue(input, signal),
);

mcp.tool(
  {
    name: JIRA_ASSIGN_ISSUE,
    description:
      "Assign one exact Jira issue to one exact username after one-time approval, treating an unchanged assignee as a no-op.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["issueKey", "assignee"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
        assignee: { type: "string", minLength: 1, maxLength: 255 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "issueKey", "assignee"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: {
          enum: ["already_assigned", "assigned", "assigned_unconfirmed"],
        },
        issueKey: { type: "string" },
        assignee: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.assignIssue(input, signal),
);

mcp.tool(
  {
    name: JIRA_UNASSIGN_ISSUE,
    description:
      "Clear the assignee of one exact Jira issue after one-time approval, treating an already empty assignee as a no-op.",
    risk: "action",
    inputSchema: ISSUE_KEY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "issueKey"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: {
          enum: ["already_unassigned", "unassigned", "unassigned_unconfirmed"],
        },
        issueKey: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.unassignIssue(input, signal),
);

mcp.tool(
  {
    name: JIRA_REMOVE_ISSUE_LINK,
    description:
      "Remove one exact Jira issue link by id after one-time approval, only when that link is currently on the named issue.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["issueKey", "linkId"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
        linkId: { type: "string", minLength: 1, maxLength: 19 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "issueKey", "linkId"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: {
          enum: ["already_absent", "removed", "removed_unconfirmed"],
        },
        issueKey: { type: "string" },
        linkId: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.removeIssueLink(input, signal),
);

const USER_OUTPUT_PROPERTIES = {
  name: { type: "string" },
  displayName: { type: "string" },
} as const;

const BOARD_ID_SCHEMA = {
  type: "string",
  minLength: 1,
  maxLength: 19,
} as const;

mcp.tool(
  {
    name: JIRA_LIST_WORKLOGS,
    description:
      "Read at most 50 worklog entries of one Jira issue with author, start time, logged duration, and a bounded comment excerpt.",
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
      required: ["fingerprint", "issueKey", "total", "worklogs"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        issueKey: { type: "string" },
        total: { type: "integer" },
        worklogs: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "started", "timeSpent", "timeSpentSeconds"],
            properties: {
              id: { type: "string" },
              author: USER_SCHEMA,
              started: { type: "string" },
              timeSpent: { type: "string" },
              timeSpentSeconds: { type: "integer" },
              comment: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listWorklogs(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_ATTACHMENTS,
    description:
      "Read the attachment metadata of one Jira issue: filename, media type, size, creation time, and author. Attachment content is never transferred.",
    risk: "read",
    inputSchema: ISSUE_KEY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "issueKey", "attachments"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        issueKey: { type: "string" },
        attachments: {
          type: "array",
          maxItems: 128,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "filename", "mimeType", "sizeBytes", "created"],
            properties: {
              id: { type: "string" },
              filename: { type: "string" },
              mimeType: { type: "string" },
              sizeBytes: { type: "integer" },
              created: { type: "string" },
              author: USER_SCHEMA,
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listAttachments(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_ISSUE_LINK_TYPES,
    description:
      "Read the issue link types this Jira deployment defines, so a link action can name an exact server type rather than guess one.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "linkTypes"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        linkTypes: {
          type: "array",
          maxItems: 64,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "inward", "outward"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              inward: { type: "string" },
              outward: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listIssueLinkTypes(input, signal),
);

mcp.tool(
  {
    name: JIRA_GET_USER,
    description:
      "Read one Jira user's stable username, display name, and active state. No email address, avatar, or group membership is returned.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 1,
      required: ["username"],
      properties: {
        username: { type: "string", minLength: 1, maxLength: 255 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "name", "displayName", "active"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        ...USER_OUTPUT_PROPERTIES,
        active: { type: "boolean" },
      },
    },
  },
  (input, { site, signal }) => site.getUser(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_VERSIONS,
    description:
      "Read at most 50 versions of one Jira project with release and archive state, release date, and a bounded description excerpt.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["projectKey"],
      properties: { projectKey: PROJECT_KEY_SCHEMA, limit: LIMIT_SCHEMA },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "projectKey", "versions"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        projectKey: { type: "string" },
        versions: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "released", "archived"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              released: { type: "boolean" },
              archived: { type: "boolean" },
              releaseDate: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listVersions(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_BOARDS,
    description:
      "Read at most 50 Jira agile boards the signed-in user can see, optionally narrowed by a bounded name substring.",
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
      required: ["fingerprint", "boards"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        boards: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "type"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              type: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listBoards(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_SPRINTS,
    description:
      "Read at most 50 sprints of one exact Jira board, optionally narrowed to active, closed, or future sprints.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 3,
      required: ["boardId"],
      properties: {
        boardId: BOARD_ID_SCHEMA,
        state: { enum: ["active", "closed", "future"] },
        limit: LIMIT_SCHEMA,
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "boardId", "sprints"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        boardId: { type: "string" },
        sprints: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "name", "state"],
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              state: { enum: ["active", "closed", "future"] },
              startDate: { type: "string" },
              endDate: { type: "string" },
              goal: { type: "string" },
            },
          },
        },
      },
    },
  },
  (input, { site, signal }) => site.listSprints(input, signal),
);

mcp.tool(
  {
    name: JIRA_LIST_SPRINT_ISSUES,
    description:
      "Read at most 50 issues of one exact Jira sprint as typed summaries without raw Jira response data.",
    risk: "read",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["sprintId"],
      properties: { sprintId: BOARD_ID_SCHEMA, limit: LIMIT_SCHEMA },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "sprintId", "total", "issues"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        sprintId: { type: "string" },
        total: { type: "integer" },
        issues: {
          type: "array",
          maxItems: JIRA_MAX_PAGE_SIZE,
          items: ISSUE_SUMMARY_SCHEMA,
        },
      },
    },
  },
  (input, { site, signal }) => site.listSprintIssues(input, signal),
);

mcp.tool(
  {
    name: JIRA_ADD_WORKLOG,
    description:
      "Log one bounded amount of work against one exact Jira issue after one-time approval, with an optional start time and comment.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 4,
      required: ["issueKey", "timeSpent"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
        timeSpent: { type: "string", minLength: 2, maxLength: 24 },
        startedAt: { type: "string", minLength: 24, maxLength: 24 },
        comment: {
          type: "string",
          minLength: 1,
          maxLength: JIRA_MAX_TEXT_LENGTH,
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
        "worklogId",
        "timeSpent",
        "timeSpentSeconds",
      ],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { const: "added" },
        issueKey: { type: "string" },
        worklogId: { type: "string" },
        timeSpent: { type: "string" },
        timeSpentSeconds: { type: "integer" },
      },
    },
  },
  (input, { site, signal }) => site.addWorklog(input, signal),
);

mcp.tool(
  {
    name: JIRA_CREATE_VERSION,
    description:
      "Create one unreleased Jira version in one exact project after one-time approval, with an optional description and release date.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 4,
      required: ["projectKey", "name"],
      properties: {
        projectKey: PROJECT_KEY_SCHEMA,
        name: { type: "string", minLength: 1, maxLength: 255 },
        description: { type: "string", minLength: 1, maxLength: 1024 },
        releaseDate: { type: "string", minLength: 10, maxLength: 10 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "projectKey", "versionId", "name"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { const: "created" },
        projectKey: { type: "string" },
        versionId: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.createVersion(input, signal),
);

mcp.tool(
  {
    name: JIRA_CREATE_SPRINT,
    description:
      "Create one future sprint on one exact Jira board after one-time approval. It never starts, closes, or reorders a sprint.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 5,
      required: ["boardId", "name"],
      properties: {
        boardId: BOARD_ID_SCHEMA,
        name: { type: "string", minLength: 1, maxLength: 255 },
        goal: { type: "string", minLength: 1, maxLength: 1024 },
        startDate: { type: "string", minLength: 24, maxLength: 24 },
        endDate: { type: "string", minLength: 24, maxLength: 24 },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "boardId", "sprintId", "name"],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { const: "created" },
        boardId: { type: "string" },
        sprintId: { type: "string" },
        name: { type: "string" },
      },
    },
  },
  (input, { site, signal }) => site.createSprint(input, signal),
);

mcp.tool(
  {
    name: JIRA_DELETE_ISSUE,
    description:
      "Permanently delete one exact Jira issue after one-time approval. Cascading subtask deletion must be requested explicitly.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 2,
      required: ["issueKey"],
      properties: {
        issueKey: ISSUE_KEY_SCHEMA,
        deleteSubtasks: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "fingerprint",
        "state",
        "issueKey",
        "summary",
        "deletedSubtasks",
      ],
      properties: {
        fingerprint: { const: JIRA_FINGERPRINT },
        state: { const: "deleted" },
        issueKey: { type: "string" },
        summary: { type: "string" },
        deletedSubtasks: { type: "integer" },
      },
    },
  },
  (input, { site, signal }) => site.deleteIssue(input, signal),
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
    {
      id: "page-only-list-issue-links",
      tool: JIRA_LIST_ISSUE_LINKS,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-update-issue",
      tool: JIRA_UPDATE_ISSUE,
      input: { issueKey: "ABC-1", summary: "Updated summary" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-assign-issue",
      tool: JIRA_ASSIGN_ISSUE,
      input: { issueKey: "ABC-1", assignee: "jdoe" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-unassign-issue",
      tool: JIRA_UNASSIGN_ISSUE,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-remove-issue-link",
      tool: JIRA_REMOVE_ISSUE_LINK,
      input: { issueKey: "ABC-1", linkId: "30001" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-worklogs",
      tool: JIRA_LIST_WORKLOGS,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-add-worklog",
      tool: JIRA_ADD_WORKLOG,
      input: { issueKey: "ABC-1", timeSpent: "2h" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-attachments",
      tool: JIRA_LIST_ATTACHMENTS,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-issue-link-types",
      tool: JIRA_LIST_ISSUE_LINK_TYPES,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-get-user",
      tool: JIRA_GET_USER,
      input: { username: "jdoe" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-versions",
      tool: JIRA_LIST_VERSIONS,
      input: { projectKey: "ABC" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-create-version",
      tool: JIRA_CREATE_VERSION,
      input: { projectKey: "ABC", name: "1.2.0" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-boards",
      tool: JIRA_LIST_BOARDS,
      input: { limit: 5 },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-sprints",
      tool: JIRA_LIST_SPRINTS,
      input: { boardId: "12" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-list-sprint-issues",
      tool: JIRA_LIST_SPRINT_ISSUES,
      input: { sprintId: "34" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-create-sprint",
      tool: JIRA_CREATE_SPRINT,
      input: { boardId: "12", name: "Sprint 9" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-only-delete-issue",
      tool: JIRA_DELETE_ISSUE,
      input: { issueKey: "ABC-1" },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
  ],
  create: (document) => createJiraSite(createJiraDocumentSource(document)),
  discover: ({ site, signal }) => site.capabilities(signal),
  subscribe: (site, listener) => site.subscribe(listener),
});

export const jiraPack: MCPatchDefinition = jiraBrowserPack.definition;
