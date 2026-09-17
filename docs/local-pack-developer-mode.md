# Local unsigned pack developer mode

MCPatch can run a locally built declarative `.mcpack` through the packaged
extension, browser page channel, Rust bridge, and MCP transport. This path is for
development only. It does not sign, review, publish, or upgrade a pack into
registry trust.

## Import and enable

1. Build and test a pack with the [community pack CLI](community-pack-cli.md).
2. Open MCPatch's extension options page.
3. Turn on **Allow local unsigned packs**.
4. Select the exact `.mcpack` file. MCPatch does not scan its parent directory or
   retain a filesystem handle.
5. Review the `UNSIGNED_LOCAL_DEVELOPMENT` label, publisher/ID, version, digest,
   exact origins, tools, risks, and permissions.
6. Confirm the candidate. Chromium prompts only for the displayed exact HTTPS
   origin patterns; denying the prompt installs nothing.
7. Open or reload a matching page after installation. The packaged isolated
   content runtime exposes only tools discovered by the validated declarative
   program. They then follow the normal page channel, bridge, and MCP path.

Every import is a candidate, including byte-identical imports. A changed digest
is visibly marked as a replacement and requires another confirmation. Existing
authority is revoked before replacement bytes are stored or published.

## Trust and storage boundary

The extension accepts only the closed Declarative Pack Bundle v1 content envelope
emitted by `mcpatch pack build`. Publisher signatures are deliberately absent at
this tier. JavaScript handlers, WebAssembly, archives, URLs, remote modules,
filesystem references, external-network declarations, malformed JSON, duplicate
keys, incompatible versions, unsupported runtime schemas, and digest mismatches
fail closed.

Validated bundle data and local install records live in bounded extension-local
storage restricted to trusted extension contexts. Content scripts receive only
validated programs matching their exact top-level HTTPS document after developer
mode, the install record, current browser permission, dynamic script registration,
and runtime compatibility have all reconciled successfully. The website cannot
open the developer page or message the service worker externally.

The manifest declares the optional `https://*/*` request envelope because local
pack origins are not known at extension build time. This declaration grants no
website access. The trusted developer page calls Chromium's permission API from
the confirmation click and asks only for each displayed exact origin.

## Disable, uninstall, and failure behavior

Disabling a pack retains its validated bytes but first removes its in-memory
authority and closes matching page contexts. Uninstall does the same before
deleting its record. Browser permissions and dynamic content-script registrations
are cleanup resources, not the authority source, and are removed only after live
authority is gone.

Turning developer mode off disables every local pack and removes local authority.
Permission loss, corrupt storage, an incompatible restart, stale digest, runtime
definition rejection, or failed reconciliation revokes matching contexts and
removes unusable state rather than guessing that a stale record is active.

There is no directory watcher, background file scan, URL installer, network
fetcher, browser-profile reader, cookie access, or arbitrary code execution in
this workflow.
