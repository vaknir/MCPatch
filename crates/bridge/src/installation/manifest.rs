use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{
    InstallationError, NATIVE_HOST_DESCRIPTION, NATIVE_HOST_NAME, STABLE_EXTENSION_ORIGIN,
};

pub(super) const RECEIPT_OWNER: &str = "dev.mcpatch.installer";
pub(super) const RECEIPT_SCHEMA_VERSION: u8 = 1;

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NativeHostManifest {
    name: String,
    description: String,
    path: String,
    #[serde(rename = "type")]
    interface_type: String,
    allowed_origins: Vec<String>,
}

impl NativeHostManifest {
    pub(super) fn new(bridge_path: &str) -> Self {
        Self {
            name: NATIVE_HOST_NAME.to_owned(),
            description: NATIVE_HOST_DESCRIPTION.to_owned(),
            path: bridge_path.to_owned(),
            interface_type: "stdio".to_owned(),
            allowed_origins: vec![STABLE_EXTENSION_ORIGIN.to_owned()],
        }
    }

    pub(super) fn is_owned(&self) -> bool {
        self.name == NATIVE_HOST_NAME
            && self.description == NATIVE_HOST_DESCRIPTION
            && self.interface_type == "stdio"
            && self.allowed_origins == [STABLE_EXTENSION_ORIGIN]
    }

    pub(super) fn bridge_path(&self) -> &str {
        &self.path
    }
}

#[derive(Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct InstallReceipt {
    schema_version: u8,
    owner: String,
    native_host_name: String,
    manifest_sha256: String,
}

impl InstallReceipt {
    pub(super) fn new(manifest: &[u8]) -> Self {
        Self {
            schema_version: RECEIPT_SCHEMA_VERSION,
            owner: RECEIPT_OWNER.to_owned(),
            native_host_name: NATIVE_HOST_NAME.to_owned(),
            manifest_sha256: sha256_hex(manifest),
        }
    }

    pub(super) fn owns(&self, manifest: &[u8]) -> bool {
        self.schema_version == RECEIPT_SCHEMA_VERSION
            && self.owner == RECEIPT_OWNER
            && self.native_host_name == NATIVE_HOST_NAME
            && self.manifest_sha256 == sha256_hex(manifest)
    }
}

pub(super) fn serialize_with_newline<T: Serialize>(
    value: &T,
) -> Result<Vec<u8>, InstallationError> {
    let mut bytes =
        serde_json::to_vec_pretty(value).map_err(|_| InstallationError::Serialization)?;
    bytes.push(b'\n');
    Ok(bytes)
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
