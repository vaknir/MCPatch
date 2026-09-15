use std::{fmt::Write as _, os::windows::io::BorrowedHandle};

use firehazard::{
    get_current_process, get_current_thread, open_process_token, open_thread_token, token,
};

use crate::local_ipc::{WindowsIpcError, WindowsIpcErrorCode};

pub(super) fn current_process_logon_sid() -> Result<String, WindowsIpcError> {
    let token = open_process_token(get_current_process(), token::QUERY)
        .map_err(|_| identity_unavailable())?;
    token_logon_sid(&token)
}

pub(super) fn current_thread_logon_sid() -> Result<String, WindowsIpcError> {
    let token = open_thread_token(get_current_thread(), token::QUERY, true)
        .map_err(|_| identity_unavailable())?;
    token_logon_sid(&token)
}

pub(super) fn named_pipe_server_logon_sid(
    pipe: BorrowedHandle<'_>,
) -> Result<String, WindowsIpcError> {
    let process = mcpatch_windows_kernel::named_pipe_server_process(pipe)
        .map_err(|_| identity_unavailable())?;
    let token = open_process_token(&process, token::QUERY).map_err(|_| identity_unavailable())?;
    token_logon_sid(&token)
}

fn token_logon_sid(token: &firehazard::token::OwnedHandle) -> Result<String, WindowsIpcError> {
    let groups = token.logon_sid().map_err(|_| identity_unavailable())?;
    let [entry] = groups.groups() else {
        return Err(identity_unavailable());
    };
    Ok(format_sid(&entry.sid))
}

fn format_sid(sid: &firehazard::sid::Value) -> String {
    let mut value = format!("S-{}-{}", sid.revision(), sid.authority_u64());
    for subauthority in sid.subauthorities() {
        // Writing to an owned String cannot fail.
        let _ = write!(value, "-{subauthority}");
    }
    value
}

const fn identity_unavailable() -> WindowsIpcError {
    WindowsIpcError::without_source(WindowsIpcErrorCode::IdentityUnavailable)
}
