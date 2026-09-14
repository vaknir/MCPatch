mod connection;
mod fake;

pub use connection::{
    BrowserConnection, BrowserConnectionError, BrowserConnectionErrorCode, BrowserConnectionId,
    InvalidBrowserConnectionId,
};
pub use fake::{FakeBrowserConnection, FakeBrowserPeer, fake_browser_connection};
