use std::{io, os::windows::io::BorrowedHandle};

/// Return the bytes immediately readable from a connected named-pipe handle.
///
/// A zero result means the pipe is connected but currently empty. A disconnected
/// pipe is reported as an I/O error, preserving the distinction that `ReadFile`
/// obscures in `PIPE_NOWAIT` mode.
pub fn named_pipe_available(handle: BorrowedHandle<'_>) -> io::Result<u32> {
    raw::peek_available(handle)
}

#[allow(unsafe_code)]
mod raw {
    use std::{
        io,
        os::windows::io::{AsRawHandle, BorrowedHandle},
        ptr,
    };

    use windows_sys::Win32::System::Pipes::PeekNamedPipe;

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
}
