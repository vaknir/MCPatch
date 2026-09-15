/// Installed MCPatch identity whose processes may rendezvous.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum InstallChannel {
    Development,
    Production,
}

impl InstallChannel {
    #[cfg(unix)]
    pub(crate) const fn directory_name(self) -> &'static str {
        match self {
            Self::Development => "development",
            Self::Production => "production",
        }
    }
}

/// Fixed parser role selected by a local endpoint.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EndpointRole {
    Browser,
    Mcp,
}

impl EndpointRole {
    #[cfg(unix)]
    pub(crate) const fn socket_file_name(self) -> &'static str {
        match self {
            Self::Browser => "browser-v1.sock",
            Self::Mcp => "mcp-v1.sock",
        }
    }
}
