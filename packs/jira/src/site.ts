import {
  addJiraComment,
  listJiraComments,
  validateJiraAddCommentInput,
} from "./comments.js";
import {
  createJiraIssue,
  validateJiraCreateIssueInput,
} from "./create-issue.js";
import {
  discoverJiraTools,
  extractJiraCurrentContext,
  inspectJiraEnvelope,
} from "./extractor.js";
import { assignJiraIssue, unassignJiraIssue } from "./assign.js";
import {
  linkJiraIssues,
  listJiraIssueLinks,
  removeJiraIssueLink,
  validateJiraLinkIssuesInput,
} from "./links.js";
import { updateJiraIssue } from "./update-issue.js";
import {
  createJiraSprint,
  listJiraBoards,
  listJiraSprintIssues,
  listJiraSprints,
  validateJiraCreateSprintInput,
} from "./agile.js";
import { listJiraAttachments } from "./attachments.js";
import {
  deleteJiraIssue,
  validateJiraDeleteIssueInput,
} from "./delete-issue.js";
import { getJiraUser, listJiraIssueLinkTypes } from "./metadata.js";
import {
  createJiraVersion,
  listJiraVersions,
  validateJiraCreateVersionInput,
} from "./versions.js";
import {
  addJiraWorklog,
  listJiraWorklogs,
  validateJiraAddWorklogInput,
} from "./worklogs.js";
import {
  JIRA_ADD_COMMENT,
  JIRA_ADD_WORKLOG,
  JIRA_CREATE_ISSUE,
  JIRA_CREATE_SPRINT,
  JIRA_CREATE_VERSION,
  JIRA_DELETE_ISSUE,
  JIRA_LINK_ISSUES,
  JiraPackError,
  type JiraAddWorklogResult,
  type JiraCreateSprintResult,
  type JiraCreateVersionResult,
  type JiraDeleteIssueResult,
  type JiraGetUserResult,
  type JiraListAttachmentsResult,
  type JiraListBoardsResult,
  type JiraListIssueLinkTypesResult,
  type JiraListSprintIssuesResult,
  type JiraListSprintsResult,
  type JiraListVersionsResult,
  type JiraListWorklogsResult,
  type JiraAddCommentResult,
  type JiraAssignIssueResult,
  type JiraCreateIssueResult,
  type JiraCurrentContextResult,
  type JiraIssueResult,
  type JiraLinkIssuesResult,
  type JiraListCommentsResult,
  type JiraListIssueLinksResult,
  type JiraListProjectsResult,
  type JiraListTransitionsResult,
  type JiraRemoveIssueLinkResult,
  type JiraUnassignIssueResult,
  type JiraUpdateIssueResult,
  type JiraSearchIssuesResult,
  type JiraSemanticSnapshot,
  type JiraSingleUseToolName,
  type JiraToolName,
  type JiraTransitionIssueResult,
} from "./model.js";
import { listJiraProjects } from "./projects.js";
import type { JiraRestClient } from "./rest.js";
import { getJiraIssue, searchJiraIssues } from "./issues.js";
import { listJiraTransitions, transitionJiraIssue } from "./transitions.js";
import { abortIfNeeded } from "./validation.js";

export interface JiraSnapshotSource {
  read(
    signal: AbortSignal,
  ): JiraSemanticSnapshot | Promise<JiraSemanticSnapshot>;
  client(snapshot: JiraSemanticSnapshot): JiraRestClient;
  subscribe?(listener: () => void): () => void;
}

export interface JiraSite {
  capabilities(signal: AbortSignal): Promise<readonly JiraToolName[]>;
  currentContext(signal: AbortSignal): Promise<JiraCurrentContextResult>;
  getIssue(input: unknown, signal: AbortSignal): Promise<JiraIssueResult>;
  searchIssues(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraSearchIssuesResult>;
  listProjects(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListProjectsResult>;
  listComments(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListCommentsResult>;
  listTransitions(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListTransitionsResult>;
  addComment(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraAddCommentResult>;
  transitionIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraTransitionIssueResult>;
  createIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraCreateIssueResult>;
  linkIssues(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraLinkIssuesResult>;
  listIssueLinks(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListIssueLinksResult>;
  removeIssueLink(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraRemoveIssueLinkResult>;
  updateIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraUpdateIssueResult>;
  assignIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraAssignIssueResult>;
  unassignIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraUnassignIssueResult>;
  deleteIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraDeleteIssueResult>;
  listWorklogs(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListWorklogsResult>;
  addWorklog(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraAddWorklogResult>;
  listAttachments(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListAttachmentsResult>;
  listIssueLinkTypes(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListIssueLinkTypesResult>;
  getUser(input: unknown, signal: AbortSignal): Promise<JiraGetUserResult>;
  listVersions(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListVersionsResult>;
  createVersion(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraCreateVersionResult>;
  listBoards(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListBoardsResult>;
  listSprints(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListSprintsResult>;
  listSprintIssues(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListSprintIssuesResult>;
  createSprint(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraCreateSprintResult>;
  subscribe(listener: () => void): () => void;
}

export function createJiraSite(source: JiraSnapshotSource): JiraSite {
  return new ReviewedJiraSite(source);
}

class ReviewedJiraSite implements JiraSite {
  readonly #source: JiraSnapshotSource;
  readonly #consumed = new Set<JiraSingleUseToolName>();
  #capabilitySignature: string | undefined;

  constructor(source: JiraSnapshotSource) {
    if (
      typeof source?.read !== "function" ||
      typeof source?.client !== "function"
    ) {
      throw new TypeError("Jira snapshot source is invalid");
    }
    this.#source = source;
  }

  async capabilities(signal: AbortSignal): Promise<readonly JiraToolName[]> {
    const tools = discoverJiraTools(await this.#read(signal), this.#consumed);
    this.#capabilitySignature = signature(tools);
    return tools;
  }

  async currentContext(signal: AbortSignal): Promise<JiraCurrentContextResult> {
    return extractJiraCurrentContext(await this.#read(signal));
  }

  async getIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraIssueResult> {
    return getJiraIssue(await this.#client(signal), input, signal);
  }

  async searchIssues(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraSearchIssuesResult> {
    return searchJiraIssues(await this.#client(signal), input, signal);
  }

  async listProjects(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListProjectsResult> {
    return listJiraProjects(await this.#client(signal), input, signal);
  }

  async listComments(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListCommentsResult> {
    return listJiraComments(await this.#client(signal), input, signal);
  }

  async listTransitions(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListTransitionsResult> {
    return listJiraTransitions(await this.#client(signal), input, signal);
  }

  async transitionIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraTransitionIssueResult> {
    return transitionJiraIssue(await this.#client(signal), input, signal);
  }

  async addComment(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraAddCommentResult> {
    const checked = validateJiraAddCommentInput(input);
    return this.#once(JIRA_ADD_COMMENT, signal, (client) =>
      addJiraComment(client, checked, signal),
    );
  }

  async createIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraCreateIssueResult> {
    const checked = validateJiraCreateIssueInput(input);
    return this.#once(JIRA_CREATE_ISSUE, signal, (client) =>
      createJiraIssue(client, checked, signal),
    );
  }

  async linkIssues(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraLinkIssuesResult> {
    const checked = validateJiraLinkIssuesInput(input);
    return this.#once(JIRA_LINK_ISSUES, signal, (client) =>
      linkJiraIssues(client, checked, signal),
    );
  }

  async listIssueLinks(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListIssueLinksResult> {
    return listJiraIssueLinks(await this.#client(signal), input, signal);
  }

  async removeIssueLink(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraRemoveIssueLinkResult> {
    return removeJiraIssueLink(await this.#client(signal), input, signal);
  }

  async updateIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraUpdateIssueResult> {
    return updateJiraIssue(await this.#client(signal), input, signal);
  }

  async assignIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraAssignIssueResult> {
    return assignJiraIssue(await this.#client(signal), input, signal);
  }

  async unassignIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraUnassignIssueResult> {
    return unassignJiraIssue(await this.#client(signal), input, signal);
  }

  async deleteIssue(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraDeleteIssueResult> {
    const checked = validateJiraDeleteIssueInput(input);
    return this.#once(JIRA_DELETE_ISSUE, signal, (client) =>
      deleteJiraIssue(client, checked, signal),
    );
  }

  async listWorklogs(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListWorklogsResult> {
    return listJiraWorklogs(await this.#client(signal), input, signal);
  }

  async addWorklog(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraAddWorklogResult> {
    const checked = validateJiraAddWorklogInput(input);
    return this.#once(JIRA_ADD_WORKLOG, signal, (client) =>
      addJiraWorklog(client, checked, signal),
    );
  }

  async listAttachments(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListAttachmentsResult> {
    return listJiraAttachments(await this.#client(signal), input, signal);
  }

  async listIssueLinkTypes(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListIssueLinkTypesResult> {
    return listJiraIssueLinkTypes(await this.#client(signal), input, signal);
  }

  async getUser(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraGetUserResult> {
    return getJiraUser(await this.#client(signal), input, signal);
  }

  async listVersions(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListVersionsResult> {
    return listJiraVersions(await this.#client(signal), input, signal);
  }

  async createVersion(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraCreateVersionResult> {
    const checked = validateJiraCreateVersionInput(input);
    return this.#once(JIRA_CREATE_VERSION, signal, (client) =>
      createJiraVersion(client, checked, signal),
    );
  }

  async listBoards(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListBoardsResult> {
    return listJiraBoards(await this.#client(signal), input, signal);
  }

  async listSprints(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListSprintsResult> {
    return listJiraSprints(await this.#client(signal), input, signal);
  }

  async listSprintIssues(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraListSprintIssuesResult> {
    return listJiraSprintIssues(await this.#client(signal), input, signal);
  }

  async createSprint(
    input: unknown,
    signal: AbortSignal,
  ): Promise<JiraCreateSprintResult> {
    const checked = validateJiraCreateSprintInput(input);
    return this.#once(JIRA_CREATE_SPRINT, signal, (client) =>
      createJiraSprint(client, checked, signal),
    );
  }

  subscribe(listener: () => void): () => void {
    if (typeof listener !== "function") {
      throw new TypeError("Jira listener is invalid");
    }
    let active = true;
    let controller: AbortController | undefined;
    const refresh = () => {
      if (!active) return;
      controller = new AbortController();
      void this.#changed(controller.signal).then((changed) => {
        if (!active || !changed) return;
        try {
          listener();
        } catch {
          // A consumer callback cannot widen or crash the page boundary.
        }
      });
    };
    const cleanup = this.#source.subscribe?.(refresh);
    if (cleanup !== undefined && typeof cleanup !== "function") {
      throw new TypeError("Jira source cleanup is invalid");
    }
    return () => {
      if (!active) return;
      active = false;
      controller?.abort();
      cleanup?.();
    };
  }

  /**
   * Non-idempotent writes are consumed once per document context so a retrying
   * agent cannot silently duplicate a comment, an issue, or a link.
   */
  async #once<T>(
    tool: JiraSingleUseToolName,
    signal: AbortSignal,
    run: (client: JiraRestClient) => Promise<T>,
  ): Promise<T> {
    if (this.#consumed.has(tool)) {
      throw new JiraPackError("EXECUTION_FAILED", "action_already_started");
    }
    const client = await this.#client(signal);
    this.#consumed.add(tool);
    return run(client);
  }

  async #client(signal: AbortSignal): Promise<JiraRestClient> {
    const snapshot = await this.#read(signal);
    inspectJiraEnvelope(snapshot);
    return this.#source.client(snapshot);
  }

  async #read(signal: AbortSignal): Promise<JiraSemanticSnapshot> {
    abortIfNeeded(signal);
    try {
      const snapshot = await this.#source.read(signal);
      abortIfNeeded(signal);
      return snapshot;
    } catch (error) {
      if (error instanceof JiraPackError) throw error;
      abortIfNeeded(signal);
      throw new JiraPackError("EXECUTION_FAILED", "incompatible_page");
    }
  }

  async #changed(signal: AbortSignal): Promise<boolean> {
    let next: string;
    try {
      next = signature(
        discoverJiraTools(await this.#read(signal), this.#consumed),
      );
    } catch (error) {
      if (error instanceof JiraPackError && error.code === "CANCELLED") {
        return false;
      }
      next = signature([]);
    }
    if (next === this.#capabilitySignature) return false;
    this.#capabilitySignature = next;
    return true;
  }
}

function signature(tools: readonly JiraToolName[]): string {
  return tools.join("\u0000");
}
