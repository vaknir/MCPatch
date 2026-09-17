import {
  JIRA_FINGERPRINT,
  JIRA_SINGLE_USE_TOOLS,
  JIRA_TOOLS,
  JiraPackError,
  type JiraCurrentContextResult,
  type JiraSemanticSnapshot,
  type JiraSingleUseToolName,
  type JiraToolName,
} from "./model.js";
import { JIRA_CONTEXT_PATH } from "./validation.js";

const APPLICATION = /^jira(?:\s|$)/iu;

/**
 * Rejects any page that is not an enabled Jira Data Center deployment.
 *
 * Which origin that is comes from the extension, not from this pack: the
 * content runtime is registered only for the exact origin the user configured
 * and the browser granted, and every request is built from this snapshot's own
 * origin. The check here is therefore structural — a canonical HTTPS origin —
 * plus Jira's own application identity and context path.
 */
export function inspectJiraEnvelope(snapshot: JiraSemanticSnapshot): void {
  if (!isCanonicalHttpsOrigin(snapshot.origin)) {
    throw unavailable("unsupported_origin");
  }
  if (!APPLICATION.test(snapshot.application)) {
    throw unavailable("unsupported_application");
  }
  if (!JIRA_CONTEXT_PATH.test(snapshot.contextPath)) {
    throw unavailable("incompatible_page");
  }
  if (!snapshot.pathname.startsWith(`${snapshot.contextPath}/`)) {
    throw unavailable("incompatible_page");
  }
}

export function extractJiraCurrentContext(
  snapshot: JiraSemanticSnapshot,
): JiraCurrentContextResult {
  inspectJiraEnvelope(snapshot);
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    baseUrl: `${snapshot.origin}${snapshot.contextPath}`,
    contextPath: snapshot.contextPath,
    ...optional("version", snapshot.version),
    ...optional("user", snapshot.user),
    ...optional("userDisplayName", snapshot.userDisplayName),
    ...optional("issueKey", snapshot.issueKey),
    ...optional("projectKey", snapshot.projectKey),
  });
}

/**
 * Every tool needs the same Jira session, so discovery is page compatibility
 * plus the non-idempotent actions this document context has not yet consumed.
 */
export function discoverJiraTools(
  snapshot: JiraSemanticSnapshot,
  consumed: ReadonlySet<JiraSingleUseToolName>,
): readonly JiraToolName[] {
  try {
    inspectJiraEnvelope(snapshot);
  } catch (error) {
    rethrowCancellation(error);
    return Object.freeze([]);
  }
  return Object.freeze(
    JIRA_TOOLS.filter((tool) => !isSingleUse(tool) || !consumed.has(tool)),
  );
}

function isSingleUse(tool: JiraToolName): tool is JiraSingleUseToolName {
  return (JIRA_SINGLE_USE_TOOLS as readonly JiraToolName[]).includes(tool);
}

function optional(key: string, value: string | undefined): object {
  return value === undefined ? {} : { [key]: value };
}

function isCanonicalHttpsOrigin(value: unknown): boolean {
  if (
    typeof value !== "string" ||
    value.length > 2_048 ||
    value.includes("*")
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.origin === value
    );
  } catch {
    return false;
  }
}

function rethrowCancellation(error: unknown): void {
  if (error instanceof JiraPackError && error.code === "CANCELLED") {
    throw error;
  }
}

function unavailable(
  reason:
    "incompatible_page" | "unsupported_application" | "unsupported_origin",
): JiraPackError {
  return new JiraPackError("TOOL_UNAVAILABLE", reason);
}
