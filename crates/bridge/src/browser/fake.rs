use std::{num::NonZeroUsize, sync::Arc};

use futures_util::future::BoxFuture;
use tokio::sync::{Mutex, mpsc};
use tokio_util::sync::CancellationToken;

use super::{
    BrowserConnection, BrowserConnectionError, BrowserConnectionErrorCode, BrowserConnectionId,
};
use crate::protocol::Message;

/// Deterministic in-memory connection used by bridge and routing tests.
pub struct FakeBrowserConnection {
    id: BrowserConnectionId,
    outbound: Mutex<Option<mpsc::Sender<Message>>>,
    inbound: Mutex<mpsc::Receiver<Message>>,
    closed: CancellationToken,
}

/// Browser-side control surface for a [`FakeBrowserConnection`].
pub struct FakeBrowserPeer {
    outbound: mpsc::Sender<Message>,
    inbound: Mutex<mpsc::Receiver<Message>>,
    closed: CancellationToken,
}

pub fn fake_browser_connection(
    id: BrowserConnectionId,
    capacity: NonZeroUsize,
) -> (Arc<FakeBrowserConnection>, FakeBrowserPeer) {
    let (to_browser, from_bridge) = mpsc::channel(capacity.get());
    let (to_bridge, from_browser) = mpsc::channel(capacity.get());
    let closed = CancellationToken::new();

    (
        Arc::new(FakeBrowserConnection {
            id,
            outbound: Mutex::new(Some(to_browser)),
            inbound: Mutex::new(from_browser),
            closed: closed.clone(),
        }),
        FakeBrowserPeer {
            outbound: to_bridge,
            inbound: Mutex::new(from_bridge),
            closed,
        },
    )
}

impl BrowserConnection for FakeBrowserConnection {
    fn id(&self) -> &BrowserConnectionId {
        &self.id
    }

    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), BrowserConnectionError>> {
        Box::pin(async move {
            validate(&message)?;
            if self.closed.is_cancelled() {
                return Err(connection_error(BrowserConnectionErrorCode::Closed));
            }

            let outbound = self.outbound.lock().await;
            let sender = outbound
                .as_ref()
                .ok_or_else(|| connection_error(BrowserConnectionErrorCode::Closed))?;
            try_send(sender, message)
        })
    }

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, BrowserConnectionError>> {
        Box::pin(async move {
            let mut inbound = self.inbound.lock().await;
            tokio::select! {
                biased;
                _ = self.closed.cancelled() => Ok(None),
                message = inbound.recv() => Ok(message),
            }
        })
    }

    fn close(&self) -> BoxFuture<'_, Result<(), BrowserConnectionError>> {
        Box::pin(async move {
            self.closed.cancel();
            self.outbound.lock().await.take();
            Ok(())
        })
    }
}

impl FakeBrowserPeer {
    pub async fn send_to_bridge(&self, message: Message) -> Result<(), BrowserConnectionError> {
        validate(&message)?;
        if self.closed.is_cancelled() {
            return Err(connection_error(BrowserConnectionErrorCode::Closed));
        }
        try_send(&self.outbound, message)
    }

    pub async fn receive_from_bridge(&self) -> Result<Option<Message>, BrowserConnectionError> {
        let mut inbound = self.inbound.lock().await;
        tokio::select! {
            biased;
            _ = self.closed.cancelled() => Ok(None),
            message = inbound.recv() => Ok(message),
        }
    }
}

fn validate(message: &Message) -> Result<(), BrowserConnectionError> {
    message
        .validate()
        .map_err(|_| connection_error(BrowserConnectionErrorCode::InvalidMessage))
}

fn try_send(
    sender: &mpsc::Sender<Message>,
    message: Message,
) -> Result<(), BrowserConnectionError> {
    sender.try_send(message).map_err(|error| match error {
        mpsc::error::TrySendError::Full(_) => {
            connection_error(BrowserConnectionErrorCode::Backpressure)
        }
        mpsc::error::TrySendError::Closed(_) => {
            connection_error(BrowserConnectionErrorCode::Closed)
        }
    })
}

const fn connection_error(code: BrowserConnectionErrorCode) -> BrowserConnectionError {
    BrowserConnectionError::new(code)
}
