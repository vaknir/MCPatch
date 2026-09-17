import {
  JIRA_FINGERPRINT,
  JiraPackError,
  type JiraGetIssueInput,
  type JiraListTransitionsResult,
  type JiraTransition,
  type JiraTransitionIssueInput,
  type JiraTransitionIssueResult,
} from "./model.js";
import {
  responseArray,
  responseField,
  responseId,
  responseObject,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_ISSUE_KEY,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  requiredPattern,
} from "./validation.js";

const MAX_TRANSITIONS = 32;

export function validateJiraListTransitionsInput(
  value: unknown,
): JiraGetIssueInput {
  const source = closedInput(value, ["issueKey"], ["issueKey"]);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
  });
}

export function validateJiraTransitionIssueInput(
  value: unknown,
): JiraTransitionIssueInput {
  const source = closedInput(
    value,
    ["issueKey", "transitionId"],
    ["issueKey", "transitionId"],
  );
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
    transitionId: requiredPattern(
      dataValue(source, "transitionId"),
      JIRA_NUMERIC_ID,
      19,
    ),
  });
}

export async function listJiraTransitions(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListTransitionsResult> {
  const input = validateJiraListTransitionsInput(value);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    issueKey: input.issueKey,
    transitions: await readTransitions(client, input.issueKey, signal),
  });
}

/**
 * The agent may only pick a transition the server currently offers, so an
 * unavailable workflow step fails before anything is written.
 */
export async function transitionJiraIssue(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraTransitionIssueResult> {
  const input = validateJiraTransitionIssueInput(value);
  const transitions = await readTransitions(client, input.issueKey, signal);
  const target = transitions.find(
    (transition) => transition.id === input.transitionId,
  );
  if (target === undefined) {
    throw new JiraPackError("EXECUTION_FAILED", "unknown_transition");
  }
  await client.post(
    `/issue/${input.issueKey}/transitions`,
    { transition: { id: target.id } },
    signal,
  );
  const confirmed = await readStatus(client, input.issueKey, signal);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    state: confirmed === target.to ? "confirmed" : "applied_unconfirmed",
    issueKey: input.issueKey,
    transitionId: target.id,
    status: confirmed ?? target.to,
  });
}

async function readTransitions(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<readonly JiraTransition[]> {
  const decoded = await client.get(
    `/issue/${issueKey}/transitions`,
    {},
    signal,
  );
  return parseJiraTransitions(decoded);
}

export function parseJiraTransitions(
  value: unknown,
): readonly JiraTransition[] {
  const page = responseObject(value);
  const transitions = responseArray(
    dataValue(page, "transitions"),
    MAX_TRANSITIONS,
  );
  return Object.freeze(transitions.map(parseJiraTransition));
}

function parseJiraTransition(value: unknown): JiraTransition {
  const transition = responseObject(value);
  const to = responseObject(dataValue(transition, "to"));
  const category = responseObject(dataValue(to, "statusCategory"));
  return Object.freeze({
    id: responseId(dataValue(transition, "id"), JIRA_NUMERIC_ID),
    name: responseField(transition, "name"),
    to: responseField(to, "name"),
    toCategory: responseField(category, "name"),
  });
}

/** A failed confirmation read must not turn a completed write into an error. */
async function readStatus(
  client: JiraRestClient,
  issueKey: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  try {
    const decoded = await client.get(
      `/issue/${issueKey}`,
      { fields: "status" },
      signal,
    );
    const fields = responseObject(dataValue(responseObject(decoded), "fields"));
    return responseField(responseObject(dataValue(fields, "status")), "name");
  } catch (error) {
    if (error instanceof JiraPackError && error.code === "CANCELLED") {
      throw error;
    }
    return undefined;
  }
}
