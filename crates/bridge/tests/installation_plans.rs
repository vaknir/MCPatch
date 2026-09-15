use base64::{Engine as _, engine::general_purpose::STANDARD};
use mcpatch_bridge::installation::{
    ChromiumBrowser, HostPlatform, STABLE_EXTENSION_ID, STABLE_EXTENSION_ORIGIN,
    build_installation_plan,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const BRIDGE_UNIX: &str = "/opt/mcpatch/bin/mcpatch";
const BRIDGE_WINDOWS: &str = r"C:\Program Files\MCPatch\mcpatch.exe";

#[test]
fn stable_identity_is_bound_to_the_production_origin() {
    assert_eq!(STABLE_EXTENSION_ID, "imbnpameklobbabbkfkalcfcggpjacdi");
    assert_eq!(
        STABLE_EXTENSION_ORIGIN,
        "chrome-extension://imbnpameklobbabbkfkalcfcggpjacdi/"
    );

    let extension_manifest: Value =
        serde_json::from_str(include_str!("../../../apps/extension/manifest.json")).unwrap();
    let public_key = STANDARD
        .decode(extension_manifest["key"].as_str().unwrap())
        .unwrap();
    let hash = Sha256::digest(public_key);
    let derived = hash[..16]
        .iter()
        .flat_map(|byte| [byte >> 4, byte & 0x0f])
        .map(|nibble| char::from(b'a' + nibble))
        .collect::<String>();
    assert_eq!(derived, STABLE_EXTENSION_ID);
}

#[test]
fn generates_linux_user_manifest_locations_for_supported_chromium_builds() {
    let cases = [
        (
            ChromiumBrowser::GoogleChrome,
            "/home/alice/.config/google-chrome/NativeMessagingHosts/dev.mcpatch.bridge.json",
        ),
        (
            ChromiumBrowser::ChromeForTesting,
            "/home/alice/.config/google-chrome-for-testing/NativeMessagingHosts/dev.mcpatch.bridge.json",
        ),
        (
            ChromiumBrowser::Chromium,
            "/home/alice/.config/chromium/NativeMessagingHosts/dev.mcpatch.bridge.json",
        ),
    ];

    for (browser, expected) in cases {
        let plan =
            build_installation_plan(HostPlatform::Linux, browser, "/home/alice", BRIDGE_UNIX)
                .unwrap();
        assert_eq!(plan.manifest_path(), expected);
        assert_eq!(plan.registry_key(), None);
    }
}

#[test]
fn generates_macos_user_manifest_locations_for_supported_chromium_builds() {
    let cases = [
        (
            ChromiumBrowser::GoogleChrome,
            "/Users/alice/Library/Application Support/Google/Chrome/NativeMessagingHosts/dev.mcpatch.bridge.json",
        ),
        (
            ChromiumBrowser::ChromeForTesting,
            "/Users/alice/Library/Application Support/Google/ChromeForTesting/NativeMessagingHosts/dev.mcpatch.bridge.json",
        ),
        (
            ChromiumBrowser::Chromium,
            "/Users/alice/Library/Application Support/Chromium/NativeMessagingHosts/dev.mcpatch.bridge.json",
        ),
    ];

    for (browser, expected) in cases {
        let plan =
            build_installation_plan(HostPlatform::Macos, browser, "/Users/alice", BRIDGE_UNIX)
                .unwrap();
        assert_eq!(plan.manifest_path(), expected);
        assert_eq!(plan.registry_key(), None);
    }
}

#[test]
fn generates_windows_manifest_and_per_user_registry_locations() {
    let chrome = build_installation_plan(
        HostPlatform::Windows,
        ChromiumBrowser::GoogleChrome,
        r"C:\Users\Alice\AppData\Local",
        BRIDGE_WINDOWS,
    )
    .unwrap();
    assert_eq!(
        chrome.manifest_path(),
        r"C:\Users\Alice\AppData\Local\MCPatch\NativeMessagingHosts\dev.mcpatch.bridge.json"
    );
    assert_eq!(
        chrome.registry_key(),
        Some(r"Software\Google\Chrome\NativeMessagingHosts\dev.mcpatch.bridge")
    );

    let testing = build_installation_plan(
        HostPlatform::Windows,
        ChromiumBrowser::ChromeForTesting,
        r"C:\Users\Alice\AppData\Local",
        BRIDGE_WINDOWS,
    )
    .unwrap();
    assert_eq!(testing.registry_key(), chrome.registry_key());

    let chromium = build_installation_plan(
        HostPlatform::Windows,
        ChromiumBrowser::Chromium,
        r"C:\Users\Alice\AppData\Local",
        BRIDGE_WINDOWS,
    )
    .unwrap();
    assert_eq!(
        chromium.registry_key(),
        Some(r"Software\Chromium\NativeMessagingHosts\dev.mcpatch.bridge")
    );
}

#[test]
fn manifest_has_only_the_fixed_native_messaging_contract() {
    let plan = build_installation_plan(
        HostPlatform::Macos,
        ChromiumBrowser::GoogleChrome,
        "/Users/alice",
        BRIDGE_UNIX,
    )
    .unwrap();
    let manifest: Value = serde_json::from_slice(plan.manifest_json()).unwrap();

    assert_eq!(
        manifest,
        json!({
            "name": "dev.mcpatch.bridge",
            "description": "MCPatch local capability bridge",
            "path": BRIDGE_UNIX,
            "type": "stdio",
            "allowed_origins": [STABLE_EXTENSION_ORIGIN]
        })
    );
    assert!(plan.manifest_json().ends_with(b"\n"));
}

#[test]
fn rejects_noncanonical_or_control_character_paths() {
    for bad in [
        "relative/mcpatch",
        "/opt/mcpatch/../other/mcpatch",
        "/opt/mcpatch\n/bin/mcpatch",
        "/opt//mcpatch/bin",
    ] {
        assert!(
            build_installation_plan(
                HostPlatform::Linux,
                ChromiumBrowser::GoogleChrome,
                "/home/alice",
                bad,
            )
            .is_err()
        );
    }

    for bad in [
        r"mcpatch.exe",
        r"C:\Program Files\..\MCPatch\mcpatch.exe",
        "C:\\Program Files\\MCPatch\nmcpatch.exe",
        r"C:/Program Files/MCPatch/mcpatch.exe",
    ] {
        assert!(
            build_installation_plan(
                HostPlatform::Windows,
                ChromiumBrowser::GoogleChrome,
                r"C:\Users\Alice\AppData\Local",
                bad,
            )
            .is_err()
        );
    }
}
