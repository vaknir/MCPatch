use std::{fmt, io, marker::PhantomData, os::windows::io::OwnedHandle, rc::Rc};

use interprocess::os::windows::security_descriptor::{AsSecurityDescriptorExt, SecurityDescriptor};
use widestring::U16CString;
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;

/// Failure to create and exclusively own a protected named mutex.
#[derive(Debug)]
pub enum TryAcquireNamedMutexError {
    AlreadyExists,
    InvalidName,
    Io(io::Error),
}

impl fmt::Display for TryAcquireNamedMutexError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyExists => formatter.write_str("named mutex already exists"),
            Self::InvalidName => formatter.write_str("named mutex name is invalid"),
            Self::Io(_) => formatter.write_str("named mutex operation failed"),
        }
    }
}

impl std::error::Error for TryAcquireNamedMutexError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::AlreadyExists | Self::InvalidName => None,
        }
    }
}

/// Initially owned mutex guard that cannot move away from its acquiring thread.
pub struct ThreadBoundNamedMutex {
    handle: OwnedHandle,
    held: bool,
    _thread_bound: PhantomData<Rc<()>>,
}

impl ThreadBoundNamedMutex {
    pub fn try_acquire(
        name: &str,
        descriptor: &SecurityDescriptor,
    ) -> Result<Self, TryAcquireNamedMutexError> {
        let name =
            U16CString::from_str(name).map_err(|_| TryAcquireNamedMutexError::InvalidName)?;
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: u32::try_from(size_of::<SECURITY_ATTRIBUTES>())
                .expect("SECURITY_ATTRIBUTES size fits in u32"),
            lpSecurityDescriptor: std::ptr::null_mut(),
            bInheritHandle: 0,
        };
        descriptor.write_to_security_attributes(&mut attributes);
        let handle = raw::create_owned_mutex(&name, &attributes)?;

        Ok(Self {
            handle,
            held: true,
            _thread_bound: PhantomData,
        })
    }

    pub fn release(mut self) -> io::Result<()> {
        raw::release_mutex(&self.handle)?;
        self.held = false;
        Ok(())
    }
}

impl fmt::Debug for ThreadBoundNamedMutex {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("ThreadBoundNamedMutex([redacted])")
    }
}

impl Drop for ThreadBoundNamedMutex {
    fn drop(&mut self) {
        if self.held {
            let _ = raw::release_mutex(&self.handle);
        }
    }
}

// This is the complete unsafe surface of the crate. The safe guard above is
// thread-bound because Win32 mutex ownership belongs to the acquiring thread.
#[allow(unsafe_code)]
mod raw {
    use std::{
        io,
        os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle},
    };

    use widestring::U16CStr;
    use windows_sys::Win32::{
        Foundation::{ERROR_ALREADY_EXISTS, GetLastError, SetLastError},
        Security::SECURITY_ATTRIBUTES,
        System::Threading::{
            CREATE_MUTEX_INITIAL_OWNER, CreateMutexExW, MUTEX_MODIFY_STATE, ReleaseMutex,
        },
    };

    use super::TryAcquireNamedMutexError;

    const SYNCHRONIZE: u32 = 0x0010_0000;
    const REQUIRED_ACCESS: u32 = SYNCHRONIZE | MUTEX_MODIFY_STATE;

    pub(super) fn create_owned_mutex(
        name: &U16CStr,
        attributes: &SECURITY_ATTRIBUTES,
    ) -> Result<OwnedHandle, TryAcquireNamedMutexError> {
        unsafe { SetLastError(0) };
        let raw = unsafe {
            CreateMutexExW(
                attributes,
                name.as_ptr(),
                CREATE_MUTEX_INITIAL_OWNER,
                REQUIRED_ACCESS,
            )
        };
        let last_error = unsafe { GetLastError() };
        if raw.is_null() {
            return Err(TryAcquireNamedMutexError::Io(io::Error::from_raw_os_error(
                i32::try_from(last_error).unwrap_or(i32::MAX),
            )));
        }

        let handle = unsafe { OwnedHandle::from_raw_handle(raw) };
        if last_error == ERROR_ALREADY_EXISTS {
            return Err(TryAcquireNamedMutexError::AlreadyExists);
        }
        Ok(handle)
    }

    pub(super) fn release_mutex(handle: &OwnedHandle) -> io::Result<()> {
        let released = unsafe { ReleaseMutex(handle.as_raw_handle()) };
        if released == 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(())
        }
    }
}
