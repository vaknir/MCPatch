use std::sync::Arc;

use futures_util::future::BoxFuture;
use tokio::{
    sync::{Mutex, mpsc},
    task::JoinHandle,
};
use tokio_util::sync::CancellationToken;

use super::{
    LocalBrowserChannel, LocalBrowserChannelError, LocalBrowserChannelErrorCode,
    LocalBrowserChannelFactory,
};
use crate::{
    local_ipc::{EndpointRole, InstallChannel, LocalCoreConnection, connect_or_start_core},
    protocol::{Message, parse_message},
};

#[cfg(all(test, unix))]
mod tests;

const CHANNEL_CAPACITY: usize = 1;

/// Production Native Messaging channel factory for one install channel.
#[derive(Clone, Copy, Debug)]
pub struct CoreBrowserChannelFactory {
    install_channel: InstallChannel,
}

impl CoreBrowserChannelFactory {
    pub const fn new(install_channel: InstallChannel) -> Self {
        Self { install_channel }
    }
}

impl LocalBrowserChannelFactory for CoreBrowserChannelFactory {
    fn connect(
        &self,
    ) -> BoxFuture<'_, Result<Arc<dyn LocalBrowserChannel>, LocalBrowserChannelError>> {
        Box::pin(async move {
            let connection = connect_or_start_core(self.install_channel, EndpointRole::Browser)
                .await
                .map_err(LocalBrowserChannelError::from)?;
            let channel: Arc<dyn LocalBrowserChannel> = CoreLocalBrowserChannel::new(connection);
            Ok(channel)
        })
    }
}

/// One authenticated local connection with one-message backpressure in each direction.
pub struct CoreLocalBrowserChannel {
    to_core: mpsc::Sender<Message>,
    from_core: Mutex<mpsc::Receiver<Result<Message, LocalBrowserChannelError>>>,
    shutdown: CancellationToken,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl CoreLocalBrowserChannel {
    pub fn new(connection: LocalCoreConnection) -> Arc<Self> {
        let (to_core, from_adapter) = mpsc::channel(CHANNEL_CAPACITY);
        let (to_adapter, from_core) = mpsc::channel(CHANNEL_CAPACITY);
        let shutdown = CancellationToken::new();
        let worker_shutdown = shutdown.clone();
        let worker = tokio::spawn(run_connection(
            connection,
            from_adapter,
            to_adapter,
            worker_shutdown,
        ));

        Arc::new(Self {
            to_core,
            from_core: Mutex::new(from_core),
            shutdown,
            worker: Mutex::new(Some(worker)),
        })
    }
}

impl LocalBrowserChannel for CoreLocalBrowserChannel {
    fn send(&self, message: Message) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async move {
            tokio::select! {
                biased;
                () = self.shutdown.cancelled() => Err(closed_error()),
                result = self.to_core.send(message) => result.map_err(|_| closed_error()),
            }
        })
    }

    fn receive(&self) -> BoxFuture<'_, Result<Option<Message>, LocalBrowserChannelError>> {
        Box::pin(async move {
            let result = self.from_core.lock().await.recv().await;
            match result {
                Some(result) => result.map(Some),
                None if self.shutdown.is_cancelled() => Ok(None),
                None => Err(closed_error()),
            }
        })
    }

    fn close(&self) -> BoxFuture<'_, Result<(), LocalBrowserChannelError>> {
        Box::pin(async move {
            self.shutdown.cancel();
            let worker = self.worker.lock().await.take();
            if let Some(worker) = worker {
                worker.await.map_err(|_| {
                    LocalBrowserChannelError::new(LocalBrowserChannelErrorCode::Transport)
                })?;
            }
            Ok(())
        })
    }
}

impl Drop for CoreLocalBrowserChannel {
    fn drop(&mut self) {
        self.shutdown.cancel();
    }
}

enum ConnectionEvent {
    /// Boxed: protocol messages carry retained approval arguments and dwarf
    /// the other variants of this short-lived select result.
    Adapter(Option<Box<Message>>),
    Core(Result<Option<Vec<u8>>, crate::local_ipc::LocalCoreConnectionError>),
    Shutdown,
}

async fn run_connection(
    connection: LocalCoreConnection,
    mut from_adapter: mpsc::Receiver<Message>,
    to_adapter: mpsc::Sender<Result<Message, LocalBrowserChannelError>>,
    shutdown: CancellationToken,
) {
    let (mut receiver, mut sender) = connection.into_split();

    'frames: loop {
        let receive = receiver.receive_json();
        tokio::pin!(receive);
        loop {
            let event = tokio::select! {
                biased;
                () = shutdown.cancelled() => ConnectionEvent::Shutdown,
                payload = &mut receive => ConnectionEvent::Core(payload),
                message = from_adapter.recv() => ConnectionEvent::Adapter(message.map(Box::new)),
            };

            match event {
                ConnectionEvent::Shutdown | ConnectionEvent::Adapter(None) => return,
                ConnectionEvent::Adapter(Some(message)) => {
                    let payload = match encode_message(&message) {
                        Ok(payload) => payload,
                        Err(error) => {
                            report_error(&to_adapter, &shutdown, error).await;
                            return;
                        }
                    };
                    let send_result = tokio::select! {
                        biased;
                        () = shutdown.cancelled() => return,
                        result = sender.send_json(&payload) => result,
                    };
                    if let Err(error) = send_result {
                        report_error(&to_adapter, &shutdown, error.into()).await;
                        return;
                    }
                }
                ConnectionEvent::Core(Ok(Some(payload))) => {
                    let message = match parse_message(&payload) {
                        Ok(message) => message,
                        Err(_) => {
                            report_error(&to_adapter, &shutdown, malformed_error()).await;
                            return;
                        }
                    };
                    if !deliver(&to_adapter, &shutdown, Ok(message)).await {
                        return;
                    }
                    continue 'frames;
                }
                ConnectionEvent::Core(Ok(None)) => {
                    report_error(&to_adapter, &shutdown, closed_error()).await;
                    return;
                }
                ConnectionEvent::Core(Err(error)) => {
                    report_error(&to_adapter, &shutdown, error.into()).await;
                    return;
                }
            }
        }
    }
}

fn encode_message(message: &Message) -> Result<Vec<u8>, LocalBrowserChannelError> {
    message.validate().map_err(|_| malformed_error())?;
    serde_json::to_vec(message).map_err(|_| malformed_error())
}

async fn report_error(
    sender: &mpsc::Sender<Result<Message, LocalBrowserChannelError>>,
    shutdown: &CancellationToken,
    error: LocalBrowserChannelError,
) {
    let _ = deliver(sender, shutdown, Err(error)).await;
}

async fn deliver(
    sender: &mpsc::Sender<Result<Message, LocalBrowserChannelError>>,
    shutdown: &CancellationToken,
    value: Result<Message, LocalBrowserChannelError>,
) -> bool {
    tokio::select! {
        biased;
        () = shutdown.cancelled() => false,
        result = sender.send(value) => result.is_ok(),
    }
}

const fn closed_error() -> LocalBrowserChannelError {
    LocalBrowserChannelError::new(LocalBrowserChannelErrorCode::Closed)
}

const fn malformed_error() -> LocalBrowserChannelError {
    LocalBrowserChannelError::new(LocalBrowserChannelErrorCode::Malformed)
}
