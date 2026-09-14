use std::{env, io};

use thiserror::Error;
use tracing_subscriber::{
    filter::{LevelFilter, Targets},
    layer::SubscriberExt,
    util::SubscriberInitExt,
};

#[derive(Debug, Error)]
#[error("structured logging initialization failed")]
pub struct LoggingInitializationError;

/// Install stderr-only JSON logging for MCPatch-owned, audit-safe events.
pub fn initialize() -> Result<(), LoggingInitializationError> {
    let (level, invalid_level) = configured_level();
    let filter = Targets::new().with_target("mcpatch", level);
    tracing_subscriber::registry()
        .with(filter)
        .with(
            tracing_subscriber::fmt::layer()
                .json()
                .flatten_event(true)
                .with_writer(io::stderr),
        )
        .try_init()
        .map_err(|_| LoggingInitializationError)?;

    if invalid_level {
        tracing::warn!(target: "mcpatch", event = "invalid_log_level", fallback = "info");
    }
    Ok(())
}

fn configured_level() -> (LevelFilter, bool) {
    let Some(value) = env::var_os("MCPATCH_LOG") else {
        return (LevelFilter::INFO, false);
    };
    let Some(value) = value.to_str() else {
        return (LevelFilter::INFO, true);
    };
    match value.to_ascii_lowercase().as_str() {
        "off" => (LevelFilter::OFF, false),
        "error" => (LevelFilter::ERROR, false),
        "warn" => (LevelFilter::WARN, false),
        "info" => (LevelFilter::INFO, false),
        "debug" => (LevelFilter::DEBUG, false),
        "trace" => (LevelFilter::TRACE, false),
        _ => (LevelFilter::INFO, true),
    }
}
