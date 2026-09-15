/// Stable Chromium extension ID derived from the public key committed in the
/// extension manifest.
pub const STABLE_EXTENSION_ID: &str = "imbnpameklobbabbkfkalcfcggpjacdi";

/// The only browser-extension origin allowed to launch the MCPatch native host.
pub const STABLE_EXTENSION_ORIGIN: &str = "chrome-extension://imbnpameklobbabbkfkalcfcggpjacdi/";

/// Fixed Native Messaging host name used by the extension and installer.
pub const NATIVE_HOST_NAME: &str = "dev.mcpatch.bridge";

pub(crate) const NATIVE_HOST_DESCRIPTION: &str = "MCPatch local capability bridge";
