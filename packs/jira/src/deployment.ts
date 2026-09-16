/**
 * Jira Data Center is self-hosted, so its exact HTTPS origin is a deployment
 * fact rather than a reviewed constant. Pack Manifest v1 only accepts exact
 * origins, and the extension only grants authority for an origin that is also
 * present in `DECLARED_OPTIONAL_ORIGINS` and `optional_host_permissions`.
 *
 * The shipped list therefore contains one synthetic `.invalid` origin: the pack
 * is compiled, validated, and testable, yet it can never become page authority
 * until an operator replaces it with their own Jira base origin in this file,
 * in the extension manifest, and in the extension's declared origin list.
 *
 * Runtime-selected origins are a separate trust decision; see
 * `docs/adr/0014-registry-discovery-and-origin-authority.md`.
 */
export const JIRA_PLACEHOLDER_ORIGIN = "https://jira.example.invalid" as const;

/** Exact HTTPS origins that this build may expose Jira capabilities on. */
export const JIRA_SITE_ORIGINS: readonly string[] = Object.freeze([
  JIRA_PLACEHOLDER_ORIGIN,
]);

/** Origins that are real browser authority rather than synthetic placeholders. */
export const JIRA_ENABLEABLE_ORIGINS: readonly string[] = Object.freeze(
  JIRA_SITE_ORIGINS.filter((origin) => !origin.endsWith(".invalid")),
);

export function isJiraSiteOrigin(value: unknown): value is string {
  return typeof value === "string" && JIRA_SITE_ORIGINS.includes(value);
}
