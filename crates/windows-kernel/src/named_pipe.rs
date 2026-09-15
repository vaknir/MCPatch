use std::{io, os::windows::io::BorrowedHandle};

/// Return the bytes immediately readable from a connected named-pipe handle.
///
/// A zero result means the pipe is connected but currently empty. A disconnected
/// pipe is reported as an I/O error, preserving the distinction that `ReadFile`
/// obscures in `PIPE_NOWAIT` mode.
pub fn named_pipe_available(handle: BorrowedHandle<'_>) -> io::Result<u32> {
    raw::peek_available(handle)
}

/// Open the process that owns the server side of a connected named pipe.
///
/// The returned handle has only the query right required to inspect its token.
pub fn named_pipe_server_process(
    handle: BorrowedHandle<'_>,
) -> io::Result<firehazard::process::OwnedHandle> {
    raw::open_server_process(handle)
}

#[allow(unsafe_code)]
mod raw {
    use std::{
        io,
        os::windows::io::{AsRawHandle, BorrowedHandle},
        ptr,
    };

    use firehazard::FromLocalHandle as _;
    use windows_sys::Win32::System::{
        Pipes::{GetNamedPipeServerProcessId, PeekNamedPipe},
        Threading::{OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
    };

    pub(super) fn peek_available(handle: BorrowedHandle<'_>) -> io::Result<u32> {
        let mut available = 0_u32;
        let succeeded = unsafe {
            PeekNamedPipe(
                handle.as_raw_handle(),
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                &raw mut available,
                ptr::null_mut(),
            )
        };
        if succeeded == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(available)
        }
    }

    pub(super) fn open_server_process(
        handle: BorrowedHandle<'_>,
    ) -> io::Result<firehazard::process::OwnedHandle> {
        let mut process_id = 0_u32;
        let found =
            unsafe { GetNamedPipeServerProcessId(handle.as_raw_handle(), &raw mut process_id) };
        if found == 0 {
            return Err(io::Error::last_os_error());
        }

        let process = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if process.is_null() {
            return Err(io::Error::last_os_error());
        }
        unsafe { firehazard::process::OwnedHandle::from_raw(process) }
            .map_err(|error| io::Error::from_raw_os_error(i32::from(error)))
    }
}
