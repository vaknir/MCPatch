#![deny(unsafe_code)]
//! Narrow safe facade over the Win32 calls not wrapped by MCPatch dependencies.

#[cfg(windows)]
mod named_mutex;

#[cfg(windows)]
pub use named_mutex::*;
