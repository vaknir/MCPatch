use super::{HostPlatform, InstallationError};

pub(super) fn validate_canonical_absolute(
    platform: HostPlatform,
    value: &str,
) -> Result<(), InstallationError> {
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(InstallationError::InvalidPath);
    }

    match platform {
        HostPlatform::Linux | HostPlatform::Macos => validate_unix(value),
        HostPlatform::Windows => validate_windows(value),
    }
}

pub(super) fn join(platform: HostPlatform, root: &str, segments: &[&str]) -> String {
    let separator = match platform {
        HostPlatform::Linux | HostPlatform::Macos => '/',
        HostPlatform::Windows => '\\',
    };
    let mut output = root.trim_end_matches(separator).to_owned();
    for segment in segments {
        output.push(separator);
        output.push_str(segment);
    }
    output
}

fn validate_unix(value: &str) -> Result<(), InstallationError> {
    if !value.starts_with('/') || (value.len() > 1 && value.ends_with('/')) {
        return Err(InstallationError::InvalidPath);
    }
    if value[1..]
        .split('/')
        .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(InstallationError::InvalidPath);
    }
    Ok(())
}

fn validate_windows(value: &str) -> Result<(), InstallationError> {
    let bytes = value.as_bytes();
    if bytes.len() < 3
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'\\'
        || value.contains('/')
        || value.ends_with('\\')
        || value[2..].contains(':')
    {
        return Err(InstallationError::InvalidPath);
    }
    if value[3..]
        .split('\\')
        .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(InstallationError::InvalidPath);
    }
    Ok(())
}
