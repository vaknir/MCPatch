use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncWrite};

use super::{
    CallerOriginPolicy, ExtensionOrigin, LocalBrowserChannel, NativeHostError, read_message,
    write_message,
};

/// Relay validated protocol messages between Chromium framing and injected IPC.
pub async fn run<R, W, P>(
    caller_origin: impl Into<String>,
    mut browser_input: R,
    mut browser_output: W,
    origin_policy: P,
    local_channel: Arc<dyn LocalBrowserChannel>,
) -> Result<(), NativeHostError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
    P: CallerOriginPolicy,
{
    let caller_origin =
        ExtensionOrigin::parse(caller_origin).map_err(NativeHostError::CallerOrigin)?;
    origin_policy
        .authorize(&caller_origin)
        .map_err(NativeHostError::CallerOrigin)?;

    let relay_result = relay(&mut browser_input, &mut browser_output, &local_channel).await;
    let close_result = local_channel
        .close()
        .await
        .map_err(NativeHostError::LocalChannel);
    relay_result.and(close_result)
}

async fn relay<R, W>(
    browser_input: &mut R,
    browser_output: &mut W,
    local_channel: &Arc<dyn LocalBrowserChannel>,
) -> Result<(), NativeHostError>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    loop {
        tokio::select! {
            browser_message = read_message(browser_input) => {
                let Some(message) = browser_message.map_err(NativeHostError::Message)? else {
                    return Ok(());
                };
                local_channel
                    .send(message)
                    .await
                    .map_err(NativeHostError::LocalChannel)?;
            }
            local_message = local_channel.receive() => {
                let Some(message) = local_message.map_err(NativeHostError::LocalChannel)? else {
                    return Ok(());
                };
                write_message(browser_output, &message)
                    .await
                    .map_err(NativeHostError::Message)?;
            }
        }
    }
}
