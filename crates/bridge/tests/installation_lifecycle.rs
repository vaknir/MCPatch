#![cfg(unix)]

use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process,
    sync::atomic::{AtomicU64, Ordering},
};

use mcpatch_bridge::installation::{
    ChromiumBrowser, HostPlatform, InstallStatus, InstallationError, UninstallStatus,
    build_installation_plan, install_plan, uninstall_plan,
};

static NEXT_FIXTURE: AtomicU64 = AtomicU64::new(0);

#[test]
fn dry_run_install_idempotency_and_recoverable_uninstall_are_bounded_to_fixture_files() {
    let fixture = Fixture::new();
    let plan = fixture.plan();

    let preview = install_plan(&plan, true).unwrap();
    assert_eq!(preview.status, InstallStatus::WouldInstall);
    assert!(!Path::new(plan.manifest_path()).exists());

    let installed = install_plan(&plan, false).unwrap();
    assert_eq!(installed.status, InstallStatus::Installed);
    assert_eq!(
        fs::read(plan.manifest_path()).unwrap(),
        plan.manifest_json()
    );
    assert_eq!(fs::read(plan.receipt_path()).unwrap(), plan.receipt_json());
    assert_eq!(
        fs::metadata(plan.manifest_path())
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );

    let second = install_plan(&plan, false).unwrap();
    assert_eq!(second.status, InstallStatus::AlreadyInstalled);

    let uninstall_preview = uninstall_plan(&plan, true).unwrap();
    assert_eq!(uninstall_preview.status, UninstallStatus::WouldUninstall);
    assert!(Path::new(plan.manifest_path()).exists());

    let removed = uninstall_plan(&plan, false).unwrap();
    assert_eq!(removed.status, UninstallStatus::Uninstalled);
    assert!(!Path::new(plan.manifest_path()).exists());
    assert!(!Path::new(plan.receipt_path()).exists());
    assert!(Path::new(removed.backup_manifest_path.as_deref().unwrap()).is_file());
    assert!(Path::new(removed.backup_receipt_path.as_deref().unwrap()).is_file());

    let second_remove = uninstall_plan(&plan, false).unwrap();
    assert_eq!(second_remove.status, UninstallStatus::AlreadyAbsent);
}

#[test]
fn refuses_foreign_incomplete_tampered_and_symlinked_installations() {
    let foreign = Fixture::new();
    let foreign_plan = foreign.plan();
    fs::create_dir_all(Path::new(foreign_plan.manifest_path()).parent().unwrap()).unwrap();
    fs::write(foreign_plan.manifest_path(), foreign_plan.manifest_json()).unwrap();
    assert_eq!(
        install_plan(&foreign_plan, false),
        Err(InstallationError::InstallationInconsistent)
    );
    assert_eq!(
        uninstall_plan(&foreign_plan, false),
        Err(InstallationError::InstallationInconsistent)
    );

    let tampered = Fixture::new();
    let tampered_plan = tampered.plan();
    install_plan(&tampered_plan, false).unwrap();
    fs::write(tampered_plan.manifest_path(), b"{}\n").unwrap();
    assert_eq!(
        install_plan(&tampered_plan, false),
        Err(InstallationError::ExistingInstallationNotOwned)
    );
    assert_eq!(
        uninstall_plan(&tampered_plan, false),
        Err(InstallationError::ExistingInstallationNotOwned)
    );

    let linked = Fixture::new();
    let linked_plan = linked.plan();
    let parent = Path::new(linked_plan.manifest_path()).parent().unwrap();
    fs::create_dir_all(parent).unwrap();
    let outside = linked.root.join("outside-manifest.json");
    fs::write(&outside, linked_plan.manifest_json()).unwrap();
    symlink(outside, linked_plan.manifest_path()).unwrap();
    fs::write(linked_plan.receipt_path(), linked_plan.receipt_json()).unwrap();
    assert_eq!(
        install_plan(&linked_plan, false),
        Err(InstallationError::UnsafePermissions)
    );
}

#[test]
fn updates_only_a_receipt_owned_manifest_when_the_canonical_bridge_moves() {
    let fixture = Fixture::new();
    let original = fixture.plan();
    install_plan(&original, false).unwrap();

    let moved_bridge = fixture.root.join("mcpatch-moved-bridge");
    fs::write(&moved_bridge, b"updated test bridge").unwrap();
    fs::set_permissions(&moved_bridge, fs::Permissions::from_mode(0o700)).unwrap();
    let updated = build_installation_plan(
        HostPlatform::current().unwrap(),
        ChromiumBrowser::GoogleChrome,
        fixture.root.to_str().unwrap(),
        moved_bridge.to_str().unwrap(),
    )
    .unwrap();

    assert_eq!(
        install_plan(&updated, true).unwrap().status,
        InstallStatus::WouldUpdate
    );
    assert_eq!(
        install_plan(&updated, false).unwrap().status,
        InstallStatus::Updated
    );
    assert_eq!(
        fs::read(updated.manifest_path()).unwrap(),
        updated.manifest_json()
    );
    assert_eq!(
        install_plan(&updated, false).unwrap().status,
        InstallStatus::AlreadyInstalled
    );
}

struct Fixture {
    root: PathBuf,
    bridge: PathBuf,
}

impl Fixture {
    fn new() -> Self {
        let serial = NEXT_FIXTURE.fetch_add(1, Ordering::Relaxed);
        let root =
            std::env::temp_dir().join(format!("mcpatch-install-test-{}-{serial}", process::id()));
        fs::create_dir(&root).unwrap();
        let root = fs::canonicalize(root).unwrap();
        let bridge = root.join("mcpatch-test-bridge");
        fs::write(&bridge, b"test bridge").unwrap();
        fs::set_permissions(&bridge, fs::Permissions::from_mode(0o700)).unwrap();
        Self { root, bridge }
    }

    fn plan(&self) -> mcpatch_bridge::installation::InstallationPlan {
        build_installation_plan(
            HostPlatform::current().unwrap(),
            ChromiumBrowser::GoogleChrome,
            self.root.to_str().unwrap(),
            self.bridge.to_str().unwrap(),
        )
        .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        fs::remove_dir_all(&self.root).unwrap();
    }
}
