import { parseJiraIssueSummary } from "./issues.js";
import {
  JIRA_FINGERPRINT,
  type JiraBoard,
  type JiraCreateSprintInput,
  type JiraCreateSprintResult,
  type JiraListBoardsInput,
  type JiraListBoardsResult,
  type JiraListSprintIssuesInput,
  type JiraListSprintIssuesResult,
  type JiraListSprintsInput,
  type JiraListSprintsResult,
  type JiraSprint,
  type JiraSprintState,
} from "./model.js";
import {
  optionalResponseField,
  responseArray,
  responseCount,
  responseField,
  responseId,
  responseObject,
  truncateResponseText,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_DEFAULT_PAGE_SIZE,
  JIRA_MAX_NAME_LENGTH,
  JIRA_MAX_PAGE_SIZE,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  invalidArguments,
  optionalInteger,
  optionalText,
  requiredPattern,
  requiredText,
} from "./validation.js";

const MAX_SPRINT_NAME_LENGTH = 255;
const MAX_GOAL_LENGTH = 1_024;
const SPRINT_STATES: readonly JiraSprintState[] = Object.freeze([
  "active",
  "closed",
  "future",
]);
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const SUMMARY_FIELDS =
  "summary,status,issuetype,project,priority,assignee,updated";

export function validateJiraListBoardsInput(
  value: unknown,
): Required<JiraListBoardsInput> {
  const source = closedInput(value, ["query", "limit"], []);
  const query = optionalText(source, "query", 1, JIRA_MAX_NAME_LENGTH);
  return Object.freeze({
    query: query ?? "",
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

export function validateJiraListSprintsInput(
  value: unknown,
): JiraListSprintsInput & { readonly limit: number } {
  const source = closedInput(value, ["boardId", "state", "limit"], ["boardId"]);
  const state = optionalText(source, "state", 1, 16);
  if (
    state !== undefined &&
    !SPRINT_STATES.includes(state as JiraSprintState)
  ) {
    invalidArguments();
  }
  return Object.freeze({
    boardId: requiredPattern(dataValue(source, "boardId"), JIRA_NUMERIC_ID, 19),
    ...(state === undefined ? {} : { state: state as JiraSprintState }),
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

export function validateJiraListSprintIssuesInput(
  value: unknown,
): Required<JiraListSprintIssuesInput> {
  const source = closedInput(value, ["sprintId", "limit"], ["sprintId"]);
  return Object.freeze({
    sprintId: requiredPattern(
      dataValue(source, "sprintId"),
      JIRA_NUMERIC_ID,
      19,
    ),
    limit: optionalInteger(
      source,
      "limit",
      1,
      JIRA_MAX_PAGE_SIZE,
      JIRA_DEFAULT_PAGE_SIZE,
    ),
  });
}

export function validateJiraCreateSprintInput(
  value: unknown,
): JiraCreateSprintInput {
  const source = closedInput(
    value,
    ["boardId", "name", "goal", "startDate", "endDate"],
    ["boardId", "name"],
  );
  const goal = optionalText(source, "goal", 1, MAX_GOAL_LENGTH);
  const startDate = instant(source, "startDate");
  const endDate = instant(source, "endDate");
  if (
    startDate !== undefined &&
    endDate !== undefined &&
    startDate >= endDate
  ) {
    invalidArguments();
  }
  return Object.freeze({
    boardId: requiredPattern(dataValue(source, "boardId"), JIRA_NUMERIC_ID, 19),
    name: requiredText(dataValue(source, "name"), 1, MAX_SPRINT_NAME_LENGTH),
    ...(goal === undefined ? {} : { goal }),
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
  });
}

export async function listJiraBoards(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListBoardsResult> {
  const input = validateJiraListBoardsInput(value);
  const decoded = await client.agile.get(
    "/board",
    {
      maxResults: String(input.limit),
      ...(input.query === "" ? {} : { name: input.query }),
    },
    signal,
  );
  const page = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    boards: Object.freeze(
      responseArray(dataValue(page, "values"), input.limit).map(parseJiraBoard),
    ),
  });
}

export async function listJiraSprints(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListSprintsResult> {
  const input = validateJiraListSprintsInput(value);
  const decoded = await client.agile.get(
    `/board/${input.boardId}/sprint`,
    {
      maxResults: String(input.limit),
      ...(input.state === undefined ? {} : { state: input.state }),
    },
    signal,
  );
  const page = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    boardId: input.boardId,
    sprints: Object.freeze(
      responseArray(dataValue(page, "values"), input.limit).map(
        parseJiraSprint,
      ),
    ),
  });
}

export async function listJiraSprintIssues(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListSprintIssuesResult> {
  const input = validateJiraListSprintIssuesInput(value);
  const decoded = await client.agile.get(
    `/sprint/${input.sprintId}/issue`,
    { maxResults: String(input.limit), fields: SUMMARY_FIELDS },
    signal,
  );
  const page = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    sprintId: input.sprintId,
    total: responseCount(dataValue(page, "total"), Number.MAX_SAFE_INTEGER),
    issues: Object.freeze(
      responseArray(dataValue(page, "issues"), input.limit).map(
        parseJiraIssueSummary,
      ),
    ),
  });
}

/** Creates one future sprint on one exact board; it never starts or closes it. */
export async function createJiraSprint(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraCreateSprintResult> {
  const input = validateJiraCreateSprintInput(value);
  const decoded = await client.agile.post(
    "/sprint",
    {
      name: input.name,
      originBoardId: Number(input.boardId),
      ...(input.goal === undefined ? {} : { goal: input.goal }),
      ...(input.startDate === undefined ? {} : { startDate: input.startDate }),
      ...(input.endDate === undefined ? {} : { endDate: input.endDate }),
    },
    signal,
  );
  const created = responseObject(decoded);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: "created",
    boardId: input.boardId,
    sprintId: responseId(dataValue(created, "id"), JIRA_NUMERIC_ID),
    name: responseField(created, "name", MAX_SPRINT_NAME_LENGTH),
  });
}

function parseJiraBoard(value: unknown): JiraBoard {
  const board = responseObject(value);
  return Object.freeze({
    id: responseId(dataValue(board, "id"), JIRA_NUMERIC_ID),
    name: responseField(board, "name", MAX_SPRINT_NAME_LENGTH),
    type: responseField(board, "type", JIRA_MAX_NAME_LENGTH),
  });
}

function parseJiraSprint(value: unknown): JiraSprint {
  const sprint = responseObject(value);
  const state = responseField(sprint, "state", 16).toLowerCase();
  if (!SPRINT_STATES.includes(state as JiraSprintState)) invalidArguments();
  const goal = truncateResponseText(dataValue(sprint, "goal"), MAX_GOAL_LENGTH);
  const startDate = optionalResponseField(sprint, "startDate", 64);
  const endDate = optionalResponseField(sprint, "endDate", 64);
  return Object.freeze({
    id: responseId(dataValue(sprint, "id"), JIRA_NUMERIC_ID),
    name: responseField(sprint, "name", MAX_SPRINT_NAME_LENGTH),
    state: state as JiraSprintState,
    ...(startDate === undefined ? {} : { startDate }),
    ...(endDate === undefined ? {} : { endDate }),
    ...(goal === undefined ? {} : { goal: goal.text }),
  });
}

function instant(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = optionalText(source, key, 24, 24);
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!INSTANT.test(value) || parsed.toISOString() !== value) {
    invalidArguments();
  }
  return value;
}
