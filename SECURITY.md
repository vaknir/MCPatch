# Security policy

MCPatch operates between untrusted agents, untrusted websites, and authenticated
browser sessions. Security defects can expose user data or cause actions under a
user's identity. Treat suspected boundary failures as security issues.

## Supported versions

MCPatch is pre-alpha and has no supported production release. The `main` branch is
the only maintained line until the first release. Do not use it with sensitive
accounts or data.

## Reporting a vulnerability

Do not open a public issue with exploit details, credentials, private website data,
or a proof of concept against a real account.

Use the repository Security tab to open a private vulnerability report when that
option is available. Otherwise, contact the repository owner privately through
GitHub and include only enough detail to establish a secure follow-up channel.

Include:

- affected commit or version;
- affected component and platform;
- expected and observed boundary behavior;
- minimal reproduction using synthetic data where possible;
- impact and required attacker position; and
- suggested mitigation, if known.

Never include browser cookies, tokens, approval secrets, or real user content.

## Response expectations

The maintainer will acknowledge a reproducible report, coordinate remediation and
disclosure privately, and credit reporters who request it. There is no bug bounty
or guaranteed response time during pre-alpha development.

## Security invariants

Changes must preserve these rules:

1. No generic JavaScript, cookie, token, page-dump, filesystem, or network-proxy
   tool is exposed in normal operation.
2. Browser credentials never leave the browser trust boundary.
3. Capabilities are typed, context-scoped, origin-bound, and default-deny.
4. Website text, model output, and tool annotations never make authorization
   decisions.
5. Sensitive grants bind the exact tool, origin, canonical arguments, expiry, and
   a one-time nonce.
6. Remote metadata cannot install, enable, or execute pack code silently.
7. Protocol, schema, and output limits are enforced before expensive processing.
8. Logs use allowlisted fields and exclude raw arguments, results, page content,
   credentials, and grant material.
9. Community trust is bound to the exact publisher/pack/version/digest identity;
   unsigned local development cannot collide with or replace signed authority.
10. Registry control-plane traffic is fixed-origin, extension-owned, and separate
    from pack network authority; only the selected exact HTTPS origin may be
    requested after a user gesture.

## Dependency and secret handling

- Dependencies are pinned by lockfiles and reviewed through automated updates.
- New runtime dependencies require a clear need and security review.
- Secrets must not be committed, placed in extension manifests, passed in command
  arguments, encoded in URLs, or written to logs.
- Development fixtures must contain synthetic data only.
- Browser fixtures may pre-authorize only an exact reserved synthetic origin when
  browser-owned permission UI cannot be automated. Fixture markers, required host
  authority, and test adapters must be rejected from production extension output.
- A release artifact must be reproducibly attributable to its source commit and
  signing identity before MCPatch is offered to end users.
- The local native-host installer must use its canonical executable path, one exact
  compiled extension origin, user-level registration, and an integrity-bound
  ownership receipt. It must reject foreign or weakened files rather than adopting
  them.
- Local uninstall must unregister and preserve only receipt-proven MCPatch files;
  it must not recursively remove browser or user configuration directories.

## Scope boundaries

MCPatch cannot protect a user whose operating system, browser, MCP client, installed
extension, or trusted pack signing key is already compromised. It must still limit
the blast radius of malformed input and a compromised website or untrusted agent.

See [THREAT_MODEL.md](THREAT_MODEL.md) for the detailed model.

The community distribution decisions are recorded in
[ADR 0013](docs/adr/0013-community-pack-trust-and-lifecycle.md),
[ADR 0014](docs/adr/0014-registry-discovery-and-origin-authority.md), and the
[community pack lifecycle](docs/architecture/community-pack-lifecycle.md).
Contribution and protected release procedures are documented in
[community pack contributions](docs/community-pack-contributions.md) and
[registry publishing](docs/registry-publishing.md).
