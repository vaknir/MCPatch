use super::{
    InstallReceipt, InstallationError, NATIVE_HOST_NAME, NativeHostManifest, join,
    serialize_with_newline, validate_canonical_absolute,
};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum HostPlatform {
    Linux,
    Macos,
    Windows,
}

impl HostPlatform {
    pub const fn current() -> Option<Self> {
        if cfg!(target_os = "linux") {
            Some(Self::Linux)
        } else if cfg!(target_os = "macos") {
            Some(Self::Macos)
        } else if cfg!(target_os = "windows") {
            Some(Self::Windows)
        } else {
            None
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ChromiumBrowser {
    GoogleChrome,
    ChromeForTesting,
    Chromium,
}

impl ChromiumBrowser {
    pub const fn cli_name(self) -> &'static str {
        match self {
            Self::GoogleChrome => "google-chrome",
            Self::ChromeForTesting => "chrome-for-testing",
            Self::Chromium => "chromium",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "google-chrome" => Some(Self::GoogleChrome),
            "chrome-for-testing" => Some(Self::ChromeForTesting),
            "chromium" => Some(Self::Chromium),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct InstallationPlan {
    platform: HostPlatform,
    browser: ChromiumBrowser,
    user_root: String,
    bridge_path: String,
    manifest_path: String,
    receipt_path: String,
    registry_key: Option<String>,
    manifest_json: Vec<u8>,
    receipt_json: Vec<u8>,
}

impl InstallationPlan {
    pub const fn platform(&self) -> HostPlatform {
        self.platform
    }

    pub const fn browser(&self) -> ChromiumBrowser {
        self.browser
    }

    pub fn user_root(&self) -> &str {
        &self.user_root
    }

    pub fn bridge_path(&self) -> &str {
        &self.bridge_path
    }

    pub fn manifest_path(&self) -> &str {
        &self.manifest_path
    }

    pub fn receipt_path(&self) -> &str {
        &self.receipt_path
    }

    pub fn registry_key(&self) -> Option<&str> {
        self.registry_key.as_deref()
    }

    pub fn manifest_json(&self) -> &[u8] {
        &self.manifest_json
    }

    pub fn receipt_json(&self) -> &[u8] {
        &self.receipt_json
    }
}

pub fn build_installation_plan(
    platform: HostPlatform,
    browser: ChromiumBrowser,
    user_root: &str,
    bridge_path: &str,
) -> Result<InstallationPlan, InstallationError> {
    validate_canonical_absolute(platform, user_root)?;
    validate_canonical_absolute(platform, bridge_path)?;

    let manifest_directory = manifest_directory(platform, browser, user_root);
    let manifest_path = join(
        platform,
        &manifest_directory,
        &[&format!("{NATIVE_HOST_NAME}.json")],
    );
    let receipt_path = format!("{manifest_path}.mcpatch-install");
    let manifest_json = serialize_with_newline(&NativeHostManifest::new(bridge_path))?;
    let receipt_json = serialize_with_newline(&InstallReceipt::new(&manifest_json))?;

    Ok(InstallationPlan {
        platform,
        browser,
        user_root: user_root.to_owned(),
        bridge_path: bridge_path.to_owned(),
        manifest_path,
        receipt_path,
        registry_key: registry_key(platform, browser),
        manifest_json,
        receipt_json,
    })
}

fn manifest_directory(platform: HostPlatform, browser: ChromiumBrowser, user_root: &str) -> String {
    let segments: &[&str] = match (platform, browser) {
        (HostPlatform::Linux, ChromiumBrowser::GoogleChrome) => {
            &[".config", "google-chrome", "NativeMessagingHosts"]
        }
        (HostPlatform::Linux, ChromiumBrowser::ChromeForTesting) => &[
            ".config",
            "google-chrome-for-testing",
            "NativeMessagingHosts",
        ],
        (HostPlatform::Linux, ChromiumBrowser::Chromium) => {
            &[".config", "chromium", "NativeMessagingHosts"]
        }
        (HostPlatform::Macos, ChromiumBrowser::GoogleChrome) => &[
            "Library",
            "Application Support",
            "Google",
            "Chrome",
            "NativeMessagingHosts",
        ],
        (HostPlatform::Macos, ChromiumBrowser::ChromeForTesting) => &[
            "Library",
            "Application Support",
            "Google",
            "ChromeForTesting",
            "NativeMessagingHosts",
        ],
        (HostPlatform::Macos, ChromiumBrowser::Chromium) => &[
            "Library",
            "Application Support",
            "Chromium",
            "NativeMessagingHosts",
        ],
        (HostPlatform::Windows, _) => &["MCPatch", "NativeMessagingHosts"],
    };
    join(platform, user_root, segments)
}

fn registry_key(platform: HostPlatform, browser: ChromiumBrowser) -> Option<String> {
    if platform != HostPlatform::Windows {
        return None;
    }
    let vendor = match browser {
        ChromiumBrowser::GoogleChrome | ChromiumBrowser::ChromeForTesting => {
            r"Software\Google\Chrome"
        }
        ChromiumBrowser::Chromium => r"Software\Chromium",
    };
    Some(format!(r"{vendor}\NativeMessagingHosts\{NATIVE_HOST_NAME}"))
}
