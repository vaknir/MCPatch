export const JIRA_FINGERPRINT = "jira-datacenter-rest2-v1" as const;

/** The two fixed REST roots this pack may reach on the enabled origin. */
export const JIRA_REST_PREFIX = "/rest/api/2" as const;
export const JIRA_AGILE_PREFIX = "/rest/agile/1.0" as const;

export const JIRA_CURRENT_CONTEXT = "jira.current_context" as const;
export const JIRA_GET_ISSUE = "jira.get_issue" as const;
export const JIRA_SEARCH_ISSUES = "jira.search_issues" as const;
export const JIRA_LIST_PROJECTS = "jira.list_projects" as const;
export const JIRA_LIST_COMMENTS = "jira.list_comments" as const;
export const JIRA_LIST_TRANSITIONS = "jira.list_transitions" as const;
export const JIRA_ADD_COMMENT = "jira.add_comment" as const;
export const JIRA_TRANSITION_ISSUE = "jira.transition_issue" as const;
export const JIRA_CREATE_ISSUE = "jira.create_issue" as const;
export const JIRA_LINK_ISSUES = "jira.link_issues" as const;
export const JIRA_LIST_ISSUE_LINKS = "jira.list_issue_links" as const;
export const JIRA_REMOVE_ISSUE_LINK = "jira.remove_issue_link" as const;
export const JIRA_UPDATE_ISSUE = "jira.update_issue" as const;
export const JIRA_ASSIGN_ISSUE = "jira.assign_issue" as const;
export const JIRA_UNASSIGN_ISSUE = "jira.unassign_issue" as const;
export const JIRA_DELETE_ISSUE = "jira.delete_issue" as const;
export const JIRA_LIST_WORKLOGS = "jira.list_worklogs" as const;
export const JIRA_ADD_WORKLOG = "jira.add_worklog" as const;
export const JIRA_LIST_ATTACHMENTS = "jira.list_attachments" as const;
export const JIRA_LIST_ISSUE_LINK_TYPES = "jira.list_issue_link_types" as const;
export const JIRA_GET_USER = "jira.get_user" as const;
export const JIRA_LIST_VERSIONS = "jira.list_versions" as const;
export const JIRA_CREATE_VERSION = "jira.create_version" as const;
export const JIRA_LIST_BOARDS = "jira.list_boards" as const;
export const JIRA_LIST_SPRINTS = "jira.list_sprints" as const;
export const JIRA_LIST_SPRINT_ISSUES = "jira.list_sprint_issues" as const;
export const JIRA_CREATE_SPRINT = "jira.create_sprint" as const;

export const JIRA_TOOLS = Object.freeze([
  JIRA_ADD_COMMENT,
  JIRA_ADD_WORKLOG,
  JIRA_CREATE_ISSUE,
  JIRA_CREATE_SPRINT,
  JIRA_CREATE_VERSION,
  JIRA_DELETE_ISSUE,
  JIRA_LINK_ISSUES,
  JIRA_ASSIGN_ISSUE,
  JIRA_REMOVE_ISSUE_LINK,
  JIRA_TRANSITION_ISSUE,
  JIRA_UNASSIGN_ISSUE,
  JIRA_UPDATE_ISSUE,
  JIRA_CURRENT_CONTEXT,
  JIRA_GET_ISSUE,
  JIRA_GET_USER,
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
  JIRA_SEARCH_ISSUES,
] as const);

export type JiraToolName = (typeof JIRA_TOOLS)[number];

/**
 * Tools that append, create, or destroy are consumed once per document context.
 * Everything else sets a named end state and stays repeatable.
 */
export const JIRA_SINGLE_USE_TOOLS = Object.freeze([
  JIRA_ADD_COMMENT,
  JIRA_ADD_WORKLOG,
  JIRA_CREATE_ISSUE,
  JIRA_CREATE_SPRINT,
  JIRA_CREATE_VERSION,
  JIRA_DELETE_ISSUE,
  JIRA_LINK_ISSUES,
] as const);

export type JiraSingleUseToolName = (typeof JIRA_SINGLE_USE_TOOLS)[number];

/** Minimal bounded page facts collected from Jira's own `ajs-*` meta tags. */
export interface JiraSemanticSnapshot {
  readonly origin: string;
  readonly pathname: string;
  readonly contextPath: string;
  readonly application: string;
  readonly version?: string;
  readonly user?: string;
  readonly userDisplayName?: string;
  readonly issueKey?: string;
  readonly projectKey?: string;
}

export interface JiraCurrentContextResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly baseUrl: string;
  readonly contextPath: string;
  readonly version?: string;
  readonly user?: string;
  readonly userDisplayName?: string;
  readonly issueKey?: string;
  readonly projectKey?: string;
}

export interface JiraUser {
  readonly name: string;
  readonly displayName: string;
}

export interface JiraIssueSummary {
  readonly key: string;
  readonly summary: string;
  readonly status: string;
  readonly statusCategory: string;
  readonly issueType: string;
  readonly projectKey: string;
  readonly priority?: string;
  readonly assignee?: JiraUser;
  readonly updated: string;
}

export interface JiraIssueResult extends JiraIssueSummary {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly id: string;
  readonly reporter?: JiraUser;
  readonly resolution?: string;
  readonly labels: readonly string[];
  readonly created: string;
  readonly description?: string;
  readonly descriptionTruncated: boolean;
}

export interface JiraGetIssueInput {
  readonly issueKey: string;
}

export interface JiraSearchIssuesInput {
  readonly jql: string;
  readonly startAt?: number;
  readonly limit?: number;
}

export interface JiraSearchIssuesResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly jql: string;
  readonly startAt: number;
  readonly total: number;
  readonly issues: readonly JiraIssueSummary[];
}

export interface JiraListProjectsInput {
  readonly query?: string;
  readonly limit?: number;
}

/** A project listing input after defaults have been applied. */
export interface JiraListProjectsSelection extends JiraListProjectsInput {
  readonly limit: number;
}

export interface JiraProject {
  readonly key: string;
  readonly name: string;
  readonly projectTypeKey?: string;
}

export interface JiraListProjectsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly projects: readonly JiraProject[];
}

export interface JiraListCommentsInput {
  readonly issueKey: string;
  readonly limit?: number;
}

export interface JiraComment {
  readonly id: string;
  readonly author?: JiraUser;
  readonly created: string;
  readonly updated: string;
  readonly body: string;
  readonly bodyTruncated: boolean;
}

export interface JiraListCommentsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly issueKey: string;
  readonly total: number;
  readonly comments: readonly JiraComment[];
}

export interface JiraTransition {
  readonly id: string;
  readonly name: string;
  readonly to: string;
  readonly toCategory: string;
}

export interface JiraListTransitionsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly issueKey: string;
  readonly transitions: readonly JiraTransition[];
}

export interface JiraAddCommentInput {
  readonly issueKey: string;
  readonly body: string;
}

export interface JiraAddCommentResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "added";
  readonly issueKey: string;
  readonly commentId: string;
  readonly created: string;
}

export interface JiraTransitionIssueInput {
  readonly issueKey: string;
  readonly transitionId: string;
}

export interface JiraTransitionIssueResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "applied_unconfirmed" | "confirmed";
  readonly issueKey: string;
  readonly transitionId: string;
  readonly status: string;
}

export interface JiraCreateIssueInput {
  readonly projectKey: string;
  readonly issueType: string;
  readonly summary: string;
  readonly description?: string;
  readonly labels?: readonly string[];
}

export interface JiraCreateIssueResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "created";
  readonly issueKey: string;
  readonly id: string;
  readonly projectKey: string;
  readonly issueType: string;
}

export interface JiraLinkIssuesInput {
  readonly inwardIssueKey: string;
  readonly outwardIssueKey: string;
  readonly linkType: string;
}

export type JiraIssueLinkDirection = "inward" | "outward";

export interface JiraIssueLink {
  readonly id: string;
  readonly type: string;
  readonly direction: JiraIssueLinkDirection;
  readonly otherIssueKey: string;
}

export interface JiraListIssueLinksResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly issueKey: string;
  readonly links: readonly JiraIssueLink[];
}

export interface JiraRemoveIssueLinkInput {
  readonly issueKey: string;
  readonly linkId: string;
}

export interface JiraRemoveIssueLinkResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "already_absent" | "removed" | "removed_unconfirmed";
  readonly issueKey: string;
  readonly linkId: string;
}

/** Exactly the issue fields this pack may set, each named in the approval. */
export interface JiraUpdateIssueInput {
  readonly issueKey: string;
  readonly summary?: string;
  readonly description?: string;
  readonly priority?: string;
  readonly labels?: readonly string[];
  readonly dueDate?: string;
}

export type JiraUpdatableField =
  "description" | "dueDate" | "labels" | "priority" | "summary";

export interface JiraUpdateIssueResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "applied_unconfirmed" | "confirmed";
  readonly issueKey: string;
  readonly updatedFields: readonly JiraUpdatableField[];
}

export interface JiraAssignIssueInput {
  readonly issueKey: string;
  readonly assignee: string;
}

export interface JiraAssignIssueResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "already_assigned" | "assigned" | "assigned_unconfirmed";
  readonly issueKey: string;
  readonly assignee: string;
}

export interface JiraUnassignIssueResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state:
    "already_unassigned" | "unassigned" | "unassigned_unconfirmed";
  readonly issueKey: string;
}

export interface JiraLinkIssuesResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "already_linked" | "created_unconfirmed" | "linked";
  readonly inwardIssueKey: string;
  readonly outwardIssueKey: string;
  readonly linkType: string;
}

export interface JiraDeleteIssueInput {
  readonly issueKey: string;
  readonly deleteSubtasks?: boolean;
}

/**
 * Delete has no `*_unconfirmed` state on purpose: a post-delete read cannot
 * tell "gone" from "unreachable" through this pack's payload-free errors, so
 * Jira's own successful DELETE status is the postcondition rather than a
 * readback that could report a deletion that did not happen.
 */
export interface JiraDeleteIssueResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "deleted";
  readonly issueKey: string;
  readonly summary: string;
  readonly deletedSubtasks: number;
}

export interface JiraWorklogEntry {
  readonly id: string;
  readonly author?: JiraUser;
  readonly started: string;
  readonly timeSpent: string;
  readonly timeSpentSeconds: number;
  readonly comment?: string;
}

export interface JiraListWorklogsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly issueKey: string;
  readonly total: number;
  readonly worklogs: readonly JiraWorklogEntry[];
}

export interface JiraAddWorklogInput {
  readonly issueKey: string;
  readonly timeSpent: string;
  readonly startedAt?: string;
  readonly comment?: string;
}

export interface JiraAddWorklogResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "added";
  readonly issueKey: string;
  readonly worklogId: string;
  readonly timeSpent: string;
  readonly timeSpentSeconds: number;
}

/** Attachment metadata only; this pack never transfers attachment bytes. */
export interface JiraAttachment {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly created: string;
  readonly author?: JiraUser;
}

export interface JiraListAttachmentsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly issueKey: string;
  readonly attachments: readonly JiraAttachment[];
}

export interface JiraIssueLinkType {
  readonly id: string;
  readonly name: string;
  readonly inward: string;
  readonly outward: string;
}

export interface JiraListIssueLinkTypesResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly linkTypes: readonly JiraIssueLinkType[];
}

export interface JiraGetUserInput {
  readonly username: string;
}

export interface JiraGetUserResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly name: string;
  readonly displayName: string;
  readonly active: boolean;
}

export interface JiraVersion {
  readonly id: string;
  readonly name: string;
  readonly released: boolean;
  readonly archived: boolean;
  readonly releaseDate?: string;
  readonly description?: string;
}

export interface JiraListVersionsInput {
  readonly projectKey: string;
  readonly limit?: number;
}

export interface JiraListVersionsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly projectKey: string;
  readonly versions: readonly JiraVersion[];
}

export interface JiraCreateVersionInput {
  readonly projectKey: string;
  readonly name: string;
  readonly description?: string;
  readonly releaseDate?: string;
}

export interface JiraCreateVersionResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "created";
  readonly projectKey: string;
  readonly versionId: string;
  readonly name: string;
}

export interface JiraBoard {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

export interface JiraListBoardsInput {
  readonly query?: string;
  readonly limit?: number;
}

export interface JiraListBoardsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly boards: readonly JiraBoard[];
}

export type JiraSprintState = "active" | "closed" | "future";

export interface JiraSprint {
  readonly id: string;
  readonly name: string;
  readonly state: JiraSprintState;
  readonly startDate?: string;
  readonly endDate?: string;
  readonly goal?: string;
}

export interface JiraListSprintsInput {
  readonly boardId: string;
  readonly state?: JiraSprintState;
  readonly limit?: number;
}

export interface JiraListSprintsResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly boardId: string;
  readonly sprints: readonly JiraSprint[];
}

export interface JiraListSprintIssuesInput {
  readonly sprintId: string;
  readonly limit?: number;
}

export interface JiraListSprintIssuesResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly sprintId: string;
  readonly total: number;
  readonly issues: readonly JiraIssueSummary[];
}

export interface JiraCreateSprintInput {
  readonly boardId: string;
  readonly name: string;
  readonly goal?: string;
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface JiraCreateSprintResult {
  readonly fingerprint: typeof JIRA_FINGERPRINT;
  readonly state: "created";
  readonly boardId: string;
  readonly sprintId: string;
  readonly name: string;
}

export type JiraErrorCode =
  "CANCELLED" | "EXECUTION_FAILED" | "TOOL_UNAVAILABLE";

export type JiraErrorReason =
  | "action_already_started"
  | "ambiguous_value"
  | "cancelled"
  | "comment_action_unavailable"
  | "create_action_unavailable"
  | "incompatible_page"
  | "invalid_arguments"
  | "link_action_unavailable"
  | "missing_value"
  | "no_updatable_field"
  | "subtasks_present"
  | "unknown_issue_link"
  | "request_failed"
  | "transition_action_unavailable"
  | "unknown_transition"
  | "unsupported_application"
  | "unsupported_origin";

/** Payload-free pack error normalized by the browser SDK. */
export class JiraPackError extends Error {
  readonly code: JiraErrorCode;
  readonly reason: JiraErrorReason;

  constructor(code: JiraErrorCode, reason: JiraErrorReason) {
    super(`Jira pack failed: ${reason}`);
    this.name = "JiraPackError";
    this.code = code;
    this.reason = reason;
  }
}
