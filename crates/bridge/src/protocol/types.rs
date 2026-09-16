use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub type JsonObject = Map<String, Value>;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Message {
    Hello(Hello),
    HelloAck(HelloAck),
    CapabilitySnapshot(CapabilitySnapshot),
    ContextClosed(ContextClosed),
    ToolCall(ToolCall),
    ToolResult(ToolResult),
    ToolError(ToolError),
    Cancel(Cancel),
    ApprovalRequired(ApprovalRequired),
    ApprovalResult(ApprovalResult),
    Heartbeat(Heartbeat),
    ConnectionError(ConnectionError),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Hello {
    pub protocol_version: u32,
    pub role: Role,
    pub supported_protocol_versions: Vec<u32>,
    pub implementation: Implementation,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HelloAck {
    pub protocol_version: u32,
    pub supported_protocol_versions: Vec<u32>,
    pub selected_protocol_version: u32,
    pub connection_id: String,
    pub implementation: Implementation,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Bridge,
    Extension,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Implementation {
    pub name: String,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct CapabilitySnapshot {
    pub protocol_version: u32,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub capabilities: Vec<Capability>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Capability {
    pub name: String,
    pub title: Option<String>,
    pub description: String,
    pub origin: String,
    pub source: CapabilitySource,
    pub pack: Option<PackReference>,
    pub risk: Risk,
    pub permissions: Vec<Permission>,
    pub input_schema: JsonObject,
    pub output_schema: Option<JsonObject>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub enum CapabilitySource {
    #[serde(rename = "native_webmcp")]
    NativeWebMcp,
    #[serde(rename = "pack")]
    Pack,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PackReference {
    pub publisher: String,
    pub id: String,
    pub version: String,
    pub digest: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Permission {
    Read,
    Action,
    Sensitive,
    Credential,
    ExternalNetwork,
    ArbitraryExecution,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Risk {
    Read,
    Action,
    Sensitive,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ContextClosed {
    pub protocol_version: u32,
    pub context_id: String,
    pub context_revision: u64,
    pub reason: ContextClosedReason,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ContextClosedReason {
    Navigation,
    TabClosed,
    PackDisabled,
    Disconnected,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolCall {
    pub protocol_version: u32,
    pub request_id: String,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub tool: String,
    pub args: JsonObject,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolResult {
    pub protocol_version: u32,
    pub request_id: String,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub result: Value,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<ToolContent>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolContent {
    Image(ToolImageContent),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolImageContent {
    pub mime_type: String,
    pub data: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ToolError {
    pub protocol_version: u32,
    pub request_id: String,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode {
    InvalidRequest,
    UnsupportedVersion,
    InvalidState,
    Unauthorized,
    CapabilityDenied,
    OriginMismatch,
    ContextNotFound,
    ToolNotFound,
    ApprovalRequired,
    ApprovalDenied,
    Cancelled,
    Timeout,
    ExecutionFailed,
    ResultInvalid,
    InternalError,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Cancel {
    pub protocol_version: u32,
    pub request_id: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalRequired {
    pub protocol_version: u32,
    pub approval_id: String,
    pub request_id: String,
    pub context_id: String,
    pub context_revision: u64,
    pub origin: String,
    pub tool: String,
    /// The bridge-validated arguments the hash binds, so the human can read
    /// what they are approving. Results never travel in approval messages.
    pub args: JsonObject,
    pub args_hash: String,
    pub expires_at: String,
    pub requester: ApprovalRequester,
}

/// Which MCP client is asking. Display-only text for the prompt; the bridge
/// never uses it for policy, so a client cannot gain anything by lying.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalRequester {
    pub client: String,
    pub session: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ApprovalResult {
    pub protocol_version: u32,
    pub approval_id: String,
    pub request_id: String,
    pub decision: ApprovalDecision,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approved,
    Denied,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Heartbeat {
    pub protocol_version: u32,
    pub heartbeat_id: String,
    pub sent_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConnectionError {
    pub protocol_version: u32,
    pub code: ErrorCode,
    pub message: String,
    pub fatal: bool,
}
