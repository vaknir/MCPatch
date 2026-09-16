export const MAX_OPERATIONS_PAYLOAD_BYTES = 256 * 1024;
export const MAX_OPERATION_AST_NODES = 256;
export const MAX_PROJECTION_DEPTH = 8;
export const MAX_OPERATION_OBJECT_FIELDS = 32;
export const MAX_OPERATION_LIST_ITEMS = 64;
export const MAX_SELECTOR_MATCHES = 256;
export const MAX_NODE_VISITS = 2_048;
export const MAX_TEXT_CHARS = 4_096;
export const MAX_ATTRIBUTE_CHARS = 2_048;
export const MAX_OUTPUT_NODES = 512;
export const MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_OPERATION_DEADLINE_MS = 5_000;

export const MAX_ACCESSIBLE_NAME_CHARS = 128;
export const MAX_SELECTOR_ID_CHARS = 128;
export const MAX_SELECTOR_CLASS_CHARS = 64;
export const MAX_SELECTOR_CLASSES = 8;
export const MAX_SELECTOR_ATTRIBUTES = 8;
export const MAX_SELECTOR_ATTRIBUTE_VALUE_CHARS = 256;
export const MAX_OUTPUT_KEY_CHARS = 64;

export const OPERATIONS_VALIDATION_LIMITS = Object.freeze({
  payloadBytes: MAX_OPERATIONS_PAYLOAD_BYTES,
  astNodesPerTool: MAX_OPERATION_AST_NODES,
  projectionDepth: MAX_PROJECTION_DEPTH,
  objectFields: MAX_OPERATION_OBJECT_FIELDS,
  listItems: MAX_OPERATION_LIST_ITEMS,
  selectorMatches: MAX_SELECTOR_MATCHES,
  nodeVisits: MAX_NODE_VISITS,
  textChars: MAX_TEXT_CHARS,
  attributeChars: MAX_ATTRIBUTE_CHARS,
  outputNodes: MAX_OUTPUT_NODES,
  outputBytes: MAX_OUTPUT_BYTES,
  deadlineMs: MAX_OPERATION_DEADLINE_MS,
});

export const DECLARATIVE_OPERATION_RUNTIME_LIMITS = Object.freeze({
  maxNodeVisits: MAX_NODE_VISITS,
  maxMatches: MAX_SELECTOR_MATCHES,
  maxTextChars: MAX_TEXT_CHARS,
  maxAttributeChars: MAX_ATTRIBUTE_CHARS,
  maxOutputNodes: MAX_OUTPUT_NODES,
  maxOutputBytes: MAX_OUTPUT_BYTES,
  deadlineMs: MAX_OPERATION_DEADLINE_MS,
});
