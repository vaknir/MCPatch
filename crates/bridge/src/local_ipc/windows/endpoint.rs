use std::{io, path::Path};

use firehazard::winapi::shared::winerror::ERROR_ACCESS_DENIED;
use interprocess::os::windows::named_pipe::{PipeListener, PipeListenerOptions, pipe_mode};

use super::{
    identity::current_process_logon_sid, security::security_descriptor_for,
    stream::AuthenticatedWindowsStream,
};
use crate::local_ipc::{EndpointRole, InstallChannel, WindowsIpcError, WindowsIpcErrorCode};

type BytePipeListener = PipeListener<pipe_mode::Bytes, pipe_mode::Bytes>;

/// Windows endpoint configuration scoped to one install channel and logon.
#[derive(Clone, Debug)]
pub struct WindowsRuntime {
    pub(super) channel: InstallChannel,
    pub(super) expected_logon_sid: String,
}

/// Bound first-instance named pipe with an explicit protected DACL.
#[derive(Debug)]
pub struct WindowsEndpointListener {
    listener: BytePipeListener,
    expected_logon_sid: String,
}

impl WindowsRuntime {
    pub fn current(channel: InstallChannel) -> Result<Self, WindowsIpcError> {
        Ok(Self {
            channel,
            expected_logon_sid: current_process_logon_sid()?,
        })
    }

    /// Return the fixed local pipe name for a parser role.
    pub fn pipe_name(&self, role: EndpointRole) -> String {
        pipe_name(self.channel, role)
    }

    /// Bind after the protected named-mutex election introduced by issue #45.
    pub fn bind_after_election(
        &self,
        role: EndpointRole,
    ) -> Result<WindowsEndpointListener, WindowsIpcError> {
        self.bind(role, false)
    }

    pub(crate) fn bind_core_endpoint(
        &self,
        role: EndpointRole,
    ) -> Result<WindowsEndpointListener, WindowsIpcError> {
        self.bind(role, true)
    }

    fn bind(
        &self,
        role: EndpointRole,
        nonblocking: bool,
    ) -> Result<WindowsEndpointListener, WindowsIpcError> {
        let descriptor = security_descriptor_for(&self.expected_logon_sid)?;
        let path = self.pipe_name(role);
        let listener = PipeListenerOptions::new()
            .path(Path::new(&path))
            .accept_remote(false)
            .inheritable(false)
            .nonblocking(nonblocking)
            .security_descriptor(Some(descriptor))
            .create_duplex::<pipe_mode::Bytes>()
            .map_err(listener_error)?;

        Ok(WindowsEndpointListener {
            listener,
            expected_logon_sid: self.expected_logon_sid.clone(),
        })
    }
}

impl WindowsEndpointListener {
    /// Accept and verify the client's effective logon SID before returning it.
    pub fn accept_authenticated(&self) -> Result<AuthenticatedWindowsStream, WindowsIpcError> {
        let stream = self
            .listener
            .accept()
            .map_err(|error| WindowsIpcError::with_source(WindowsIpcErrorCode::Io, error))?;
        AuthenticatedWindowsStream::authenticate(stream, &self.expected_logon_sid)
    }

    pub(crate) fn try_accept_authenticated(
        &self,
    ) -> Result<Option<AuthenticatedWindowsStream>, WindowsIpcError> {
        match self.listener.accept() {
            Ok(stream) => {
                AuthenticatedWindowsStream::authenticate(stream, &self.expected_logon_sid).map(Some)
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(WindowsIpcError::with_source(WindowsIpcErrorCode::Io, error)),
        }
    }
}

fn pipe_name(channel: InstallChannel, role: EndpointRole) -> String {
    let channel = match channel {
        InstallChannel::Development => "development",
        InstallChannel::Production => "production",
    };
    let role = match role {
        EndpointRole::Browser => "browser",
        EndpointRole::Mcp => "mcp",
    };
    format!(r"\\.\pipe\MCPatch-{channel}-{role}-v1")
}

fn listener_error(error: io::Error) -> WindowsIpcError {
    let code = if error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) {
        WindowsIpcErrorCode::EndpointInUse
    } else {
        WindowsIpcErrorCode::Io
    };
    WindowsIpcError::with_source(code, error)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn channels_and_parser_roles_have_distinct_versioned_names() {
        assert_eq!(
            pipe_name(InstallChannel::Development, EndpointRole::Browser),
            r"\\.\pipe\MCPatch-development-browser-v1"
        );
        assert_ne!(
            pipe_name(InstallChannel::Development, EndpointRole::Browser),
            pipe_name(InstallChannel::Development, EndpointRole::Mcp)
        );
        assert_ne!(
            pipe_name(InstallChannel::Development, EndpointRole::Browser),
            pipe_name(InstallChannel::Production, EndpointRole::Browser)
        );
    }
}
