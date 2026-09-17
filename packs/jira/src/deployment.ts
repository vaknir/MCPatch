/**
 * Jira Data Center is self-hosted, so its exact HTTPS origin is a deployment
 * fact that only the user knows. Pack Manifest v1 accepts exact origins only,
 * so the shipped manifest declares one synthetic `.invalid` origin as a marker:
 * the pack is compiled, validated, and testable, and contributes no site to the
 * reviewed catalog until the user configures a real origin in the extension.
 *
 * The extension substitutes the configured origin for this placeholder, then
 * requests and proves that exact origin at a user gesture. The placeholder is
 * never requested, never granted, and never matched against a real page.
 *
 * See `docs/adr/0015-configurable-pack-origins.md`.
 */
export const JIRA_ORIGIN_PLACEHOLDER = "https://jira.example.invalid" as const;

/** Every path of the configured origin; Jira is one application per host. */
export const JIRA_PATH_PREFIX = "/" as const;
