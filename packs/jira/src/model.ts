export const JIRA_FINGERPRINT = "jira-datacenter-rest2-v1" as const;

/** Every request this pack may issue is rooted at this fixed REST prefix. */
export const JIRA_REST_PREFIX = "/rest/api/2" as const;

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

export const JIRA_TOOLS = Object.freeze([
  JIRA_ADD_COMMENT,
  JIRA_CREATE_ISSUE,
  JIRA_LINK_ISSUES,
  JIRA_ASSIGN_ISSUE,
  JIRA_REMOVE_ISSUE_LINK,
  JIRA_TRANSITION_ISSUE,
  JIRA_UNASSIGN_ISSUE,
  JIRA_UPDATE_ISSUE,
  JIRA_CURRENT_CONTEXT,
  JIRA_GET_ISSUE,
  JIRA_LIST_COMMENTS,
  JIRA_LIST_ISSUE_LINKS,
  JIRA_LIST_PROJECTS,
  JIRA_LIST_TRANSITIONS,
  JIRA_SEARCH_ISSUES,
] as const);

export type JiraToolName = (typeof JIRA_TOOLS)[number];

/** Non-idempotent tools are consumed once per document context. */
export const JIRA_SINGLE_USE_TOOLS = Object.freeze([
  JIRA_ADD_COMMENT,
  JIRA_CREATE_ISSUE,
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
