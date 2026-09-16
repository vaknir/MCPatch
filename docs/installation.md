# Local packaging and Chromium registration

MCPatch remains pre-alpha. This flow is for local verification with a disposable
browser profile, not sensitive accounts or public distribution.

## Build an attributable package

From a clean committed checkout, run:

```sh
pnpm package:local
```

The command builds the release Rust bridge and MV3 extension, then creates
`.artifacts/mcpatch-<version>-<platform>-<architecture>`. Its
`artifact-manifest.json` records the full source commit and a SHA-256 digest and
size for every bridge and extension file. The extension also contains
`build-metadata.json` with the same product version and source commit. Packaging
fails if tracked or untracked source files are present, if the revision is not a
full Git commit, or if an artifact is a symbolic link.

The package is unsigned and local-only. Public releases additionally require
platform signatures, provenance, and installation testing from the release tag.

## Register the native host

Run the packaged binary from the location that should remain installed:

```sh
./mcpatch install --dry-run
./mcpatch install
```

Google Chrome is the default. Select another supported Chromium build with
`--browser=chrome-for-testing` or `--browser=chromium`. The command always uses the
canonical path of its own executable; there is no option to inject a command,
argument, launcher, or alternate bridge path.

The installer writes a user-level Native Messaging manifest containing exactly
the fixed host name, the canonical executable path, `stdio`, and this origin:

```text
chrome-extension://imbnpameklobbabbkfkalcfcggpjacdi/
```

Linux and macOS use Chromium's documented per-user `NativeMessagingHosts`
directory. Windows stores the manifest under `%LOCALAPPDATA%\MCPatch` and writes
the exact manifest path into both per-user registry views. No administrator access
is required. Chrome for Testing uses its separate current user directory on Linux
and macOS; before Chrome 146 it shared Google Chrome's location and is not supported
by this pre-alpha installer.

The adjacent `.mcpatch-install` receipt binds ownership to the exact manifest
digest. Existing files without a valid receipt, changed fields, unsafe Unix
ownership or write permissions, symlinks, noncanonical paths, and conflicting
Windows registry entries are rejected. Repeating an unchanged install performs no
write. `--dry-run` inspects and reports without creating directories or files.

Build the extension is already included in the package. Load its `extension`
directory with **Load unpacked** on `chrome://extensions` and confirm Chromium
shows extension ID `imbnpameklobbabbkfkalcfcggpjacdi`. The manifest contains only
the public-key bytes needed to preserve this ID. The repository and package contain
no private signing key; the private half of this pre-alpha local identity was
discarded after the public key was generated.

## Runtime directory

Both adapters and the bridge core rendezvous over private local endpoints inside a
per-user runtime directory. The directory must be an absolute path owned by the
current user with mode `0700`; MCPatch creates `mcpatch/<channel>/` beneath it with
the same mode and refuses anything looser, anything owned by another user, and any
symlinked endpoint. There is deliberately no fallback to a shared temporary
directory, because a world-writable base would let another local user race the
socket paths.

- **Linux** uses `XDG_RUNTIME_DIR`, which a login session normally exports. Hosts
  without one—containers, `cron`, `systemd` services without a PAM session, and
  some SSH configurations—must set `MCPATCH_RUNTIME_DIR` to a directory that meets
  the rules above. The override only selects the base; it never relaxes a check.
- **macOS** uses the per-user temporary directory and accepts the same override.
- **Windows** uses named pipes under the current user's security descriptor and
  needs no directory.

An empty value counts as unset. When the MCP client launches `mcpatch mcp-stdio`
from an environment without a usable directory, the adapter exits before the first
response and writes one structured line to standard error. The `hint` field is a
fixed sentence; MCPatch never writes paths, user names, or environment values.

| Log event            | `code`                                     | Meaning                                                        |
| -------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `mcp_stdio_failed`   | `local_core_runtime_directory_unavailable` | Neither `MCPATCH_RUNTIME_DIR` nor the session directory is set |
| `mcp_stdio_failed`   | `local_core_runtime_unsafe`                | The directory exists but fails the ownership or mode checks    |
| `native_host_failed` | the same two codes                         | The Chromium-facing adapter hit the same condition             |
| `bridge_core_failed` | `core_runtime_directory_unavailable`       | The core could not resolve a directory                         |
| `bridge_core_failed` | `core_runtime_directory_unsafe`            | The core's directory failed the checks                         |
| `bridge_core_failed` | `core_transport_failed`                    | The directory is usable but a socket could not be bound there  |

The last row is what a filesystem without Unix-socket support produces; point the
override at a local filesystem such as `/run/user/<uid>` or a `tmpfs`.

## Enable the Google Flights pack

Use only a disposable or signed-out profile during pre-alpha testing. Open either
`https://www.google.com/travel/flights` or an existing Google Flights search, then
click the MCPatch toolbar action. Chromium should request only
`https://www.google.com/*`. Granting that optional origin stores the exact reviewed
pack identity and registers the packaged isolated-world content script. Reload the
page once after first enablement so the newly registered script owns that document.

The pack exposes `flights.current_search`, `flights.results`, and
`flights.price_insights` when their English rendered-page states are compatible. It
also exposes `flights.search` for one adult economy round trips between exact IATA
airport codes. Every search call opens an extension-owned prompt and requires a
fresh argument-bound approval before the current tab opens the exact generated
search URL. Google Flights then uses the browser's existing session to load results.
MCPatch does not click the form, replay captured credentials, select, book, sign in,
or inspect credentials.
Click the toolbar action again on a supported page to disable the pack; MCPatch
revokes live tool contexts before unregistering the script and removing the now-unused
optional host permission.

## Uninstall and recovery

Preview or remove a registration with the same browser selection:

```sh
./mcpatch uninstall --dry-run
./mcpatch uninstall
```

Uninstall proceeds only when both files have safe metadata and the receipt proves
the current manifest is MCPatch-owned. It unregisters the exact Windows keys where
applicable and moves both files beside their former location using a random
`.mcpatch-backup-<nonce>` suffix. The JSON result prints both backup paths. It does
not delete those backups.

To recover on Linux or macOS, move both reported backups back to the original
manifest and receipt paths. On Windows, do that and rerun `install` from the same
bridge binary to restore the per-user registry entries. A later successful install
may also create fresh owned files; retained backups can then be reviewed and
removed manually.

## Platform test boundary

Pure tests generate and validate Linux, macOS, and Windows paths, manifests, and
registry-key plans without touching browser configuration. Filesystem mutation
tests use unique temporary directories only. Windows code is cross-compiled from
the pinned toolchain; a Windows runner remains in CI for when hosted Actions billing
is restored.

Sources for the platform contract:

- [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)
- [Chrome manifest `key`](https://developer.chrome.com/docs/extensions/reference/manifest/key)
- [Chromium extension-ID derivation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/components/crx_file/id_util.cc)
