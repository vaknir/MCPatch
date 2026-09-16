import type { JsonObject } from "@mcpatch/sdk/runtime";

import { JIRA_REST_PREFIX, JiraPackError } from "./model.js";
import { abortIfNeeded } from "./validation.js";

const MAX_RESPONSE_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;
const JSON_MEDIA_TYPE = "application/json";
/** Reviewed call sites build every path from validated identifiers only. */
const SAFE_PATH = /^(?:\/[A-Za-z0-9][A-Za-z0-9._~-]*)+$/u;

export type JiraFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * The only network surface of this pack: same-origin calls to the fixed Jira
 * REST v2 prefix of one enabled site, using the browser's existing session.
 *
 * The method is chosen by reviewed pack code from a closed set, never by the
 * caller, who also supplies no origin, header, raw URL, or credentials mode.
 * `PUT` and `DELETE` carry no extra manifest authority: same-origin session
 * actions are not a manifest permission class (ADR 0011), and
 * `networkPolicy.extensionRequests` governs extension-issued cross-origin
 * requests, which this pack never makes.
 */
export interface JiraRestClient {
  readonly baseUrl: string;
  get(
    path: string,
    query: Readonly<Record<string, string>>,
    signal: AbortSignal,
  ): Promise<unknown>;
  post(path: string, body: JsonObject, signal: AbortSignal): Promise<unknown>;
  put(path: string, body: JsonObject, signal: AbortSignal): Promise<unknown>;
  remove(path: string, signal: AbortSignal): Promise<unknown>;
}

export function createJiraRestClient(
  origin: string,
  contextPath: string,
  fetchRequest: JiraFetch,
): JiraRestClient {
  if (typeof fetchRequest !== "function") requestFailed();
  const prefix = `${contextPath}${JIRA_REST_PREFIX}`;
  const client: JiraRestClient = {
    baseUrl: `${origin}${contextPath}`,
    get: async (path, query, signal) =>
      request(
        fetchRequest,
        requestUrl(origin, prefix, path, query),
        readInit(),
        signal,
      ),
    post: async (path, body, signal) =>
      request(
        fetchRequest,
        requestUrl(origin, prefix, path, {}),
        writeInit("POST", body),
        signal,
      ),
    put: async (path, body, signal) =>
      request(
        fetchRequest,
        requestUrl(origin, prefix, path, {}),
        writeInit("PUT", body),
        signal,
      ),
    remove: async (path, signal) =>
      request(
        fetchRequest,
        requestUrl(origin, prefix, path, {}),
        deleteInit(),
        signal,
      ),
  };
  return Object.freeze(client);
}

function requestUrl(
  origin: string,
  prefix: string,
  path: string,
  query: Readonly<Record<string, string>>,
): string {
  if (!SAFE_PATH.test(path)) requestFailed();
  const url = new URL(`${prefix}${path}`, origin);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  if (
    url.origin !== origin ||
    !url.pathname.startsWith(`${prefix}/`) ||
    url.hash !== "" ||
    url.username !== "" ||
    url.password !== ""
  ) {
    requestFailed();
  }
  return url.href;
}

function readInit(): RequestInit {
  return {
    method: "GET",
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    headers: { Accept: JSON_MEDIA_TYPE },
  };
}

function writeInit(method: "POST" | "PUT", body: JsonObject): RequestInit {
  return {
    method,
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: JSON_MEDIA_TYPE,
      "Content-Type": JSON_MEDIA_TYPE,
      "X-Atlassian-Token": "no-check",
    },
    body: JSON.stringify(body),
  };
}

function deleteInit(): RequestInit {
  return {
    method: "DELETE",
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    headers: {
      Accept: JSON_MEDIA_TYPE,
      "X-Atlassian-Token": "no-check",
    },
  };
}

async function request(
  fetchRequest: JiraFetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<unknown> {
  abortIfNeeded(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchRequest(url, {
      ...init,
      signal: controller.signal,
    });
    abortIfNeeded(signal);
    if (!response.ok || response.type === "opaqueredirect") requestFailed();
    return await decodeBoundedJson(response);
  } catch (error) {
    abortIfNeeded(signal);
    if (error instanceof JiraPackError) throw error;
    requestFailed();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

/** Accepts one bounded JSON document, or an empty body for write responses. */
async function decodeBoundedJson(response: Response): Promise<unknown> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
    requestFailed();
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_RESPONSE_BYTES) {
    requestFailed();
  }
  if (body.trim().length === 0) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(JSON_MEDIA_TYPE)) requestFailed();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    requestFailed();
  }
}

export function requestFailed(): never {
  throw new JiraPackError("EXECUTION_FAILED", "request_failed");
}
