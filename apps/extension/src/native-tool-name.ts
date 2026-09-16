import { NATIVE_TOOL_NAMESPACE } from "@mcpatch/protocol";

/** Longest tool name the bridge protocol accepts. */
const MAX_TOOL_NAME_LENGTH = 128;

/**
 * Builds the name a page-declared tool is published under.
 *
 * A native tool's own name is chosen by the page, so publishing it unchanged
 * lets a site list `flights.search` beside a reviewed pack's tool of the same
 * name. Names therefore carry their provenance: every native tool lives under
 * the reserved `native` namespace, qualified by the origin that declared it,
 * and the bridge rejects a native capability that arrives outside it.
 *
 * Returns `undefined` when no valid name can be built, so the caller drops the
 * tool rather than publishing one the bridge would refuse.
 */
export function nativeToolName(
  origin: string,
  pageName: string,
): string | undefined {
  const slug = originSlug(origin);
  if (slug === undefined || !isToolNameSegmentPath(pageName)) return undefined;
  const name = `${NATIVE_TOOL_NAMESPACE}.${slug}.${pageName}`;
  return name.length <= MAX_TOOL_NAME_LENGTH ? name : undefined;
}

/**
 * The origin's host as one tool-name segment: lowercase, with every character
 * a tool name cannot carry folded to `_`. Ports and hyphens therefore survive
 * as separators rather than making the name invalid.
 */
function originSlug(origin: string): string | undefined {
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" || url.origin !== origin) return undefined;
    host = url.host;
  } catch {
    return undefined;
  }
  const slug = host.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "_");
  return /^[a-z][a-z0-9_]*$/u.test(slug) ? slug : undefined;
}

/** A dotted run of tool-name segments, the shape the page must already use. */
function isToolNameSegmentPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u.test(value)
  );
}
