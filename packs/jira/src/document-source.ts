import { JiraPackError, type JiraSemanticSnapshot } from "./model.js";
import { createJiraRestClient, type JiraFetch } from "./rest.js";
import type { JiraSnapshotSource } from "./site.js";
import {
  JIRA_ISSUE_KEY,
  JIRA_PROJECT_KEY,
  abortIfNeeded,
} from "./validation.js";

const MAX_META_LENGTH = 256;
const OBSERVER_DELAY_MS = 150;

export function createJiraDocumentSource(
  document: Document,
  fetchRequest: JiraFetch = createDocumentFetch(document),
): JiraSnapshotSource {
  return new JiraDocumentSource(document, fetchRequest);
}

/**
 * Reads only Jira's own `ajs-*` metadata. No cookie, token, storage, generated
 * class name, or page body text is collected.
 */
export function collectJiraSemanticSnapshot(
  document: Document,
  signal: AbortSignal,
): JiraSemanticSnapshot {
  abortIfNeeded(signal);
  if (document?.nodeType !== 9) {
    throw new TypeError("Jira document source is invalid");
  }
  const location = document.location;
  abortIfNeeded(signal);
  return Object.freeze({
    origin: location.origin,
    pathname: location.pathname,
    // A malformed value is kept verbatim so envelope inspection fails closed.
    contextPath: meta(document, "context-path") ?? "",
    application: meta(document, "app-title") ?? "",
    ...optional("version", meta(document, "version-number")),
    ...optional("user", meta(document, "remote-user")),
    ...optional("userDisplayName", meta(document, "remote-user-fullname")),
    ...optional("issueKey", matched(document, "issue-key", JIRA_ISSUE_KEY)),
    ...optional(
      "projectKey",
      matched(document, "project-key", JIRA_PROJECT_KEY),
    ),
  });
}

class JiraDocumentSource implements JiraSnapshotSource {
  readonly #document: Document;
  readonly #fetchRequest: JiraFetch;

  constructor(document: Document, fetchRequest: JiraFetch) {
    if (document?.nodeType !== 9 || typeof fetchRequest !== "function") {
      throw new TypeError("Jira document source is invalid");
    }
    this.#document = document;
    this.#fetchRequest = fetchRequest;
  }

  read(signal: AbortSignal): JiraSemanticSnapshot {
    return collectJiraSemanticSnapshot(this.#document, signal);
  }

  client(snapshot: JiraSemanticSnapshot) {
    return createJiraRestClient(
      snapshot.origin,
      snapshot.contextPath,
      this.#fetchRequest,
    );
  }

  subscribe(listener: () => void): () => void {
    const view = this.#document.defaultView;
    const head = this.#document.head;
    if (view === null || head === null) {
      throw new TypeError("Jira document cannot be observed");
    }
    let pending: number | undefined;
    const observer = new view.MutationObserver(() => {
      if (pending !== undefined) view.clearTimeout(pending);
      pending = view.setTimeout(() => {
        pending = undefined;
        listener();
      }, OBSERVER_DELAY_MS);
    });
    observer.observe(head, {
      attributes: true,
      attributeFilter: ["content"],
      childList: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (pending !== undefined) view.clearTimeout(pending);
    };
  }
}

function createDocumentFetch(document: Document): JiraFetch {
  const view = document.defaultView;
  if (view === null || typeof view.fetch !== "function") {
    return async () => {
      throw new JiraPackError("EXECUTION_FAILED", "request_failed");
    };
  }
  return (input, init) => view.fetch(input, init);
}

function meta(document: Document, name: string): string | undefined {
  const element = document.querySelector(`head meta[name="ajs-${name}"]`);
  const value = element?.getAttribute("content");
  if (typeof value !== "string" || value.length > MAX_META_LENGTH) {
    return undefined;
  }
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

function matched(
  document: Document,
  name: string,
  pattern: RegExp,
): string | undefined {
  const value = meta(document, name);
  return value !== undefined && pattern.test(value) ? value : undefined;
}

function optional(key: string, value: string | undefined): object {
  return value === undefined ? {} : { [key]: value };
}
