import type { ValidationIssue } from "./error.js";
import { validateOrigin } from "./formats.js";
import {
  issue,
  type JsonRecord,
  validateIdentifier,
  validatePositiveSafeInteger,
  validateProtocolVersion,
} from "./primitives.js";

export function validateTypeAndRoute(
  message: JsonRecord,
  type: string,
): ValidationIssue | undefined {
  return (
    validateProtocolVersion(message.protocolVersion) ??
    (message.type === type ? undefined : issue("INVALID_VALUE", "type")) ??
    validateIdentifier(message.requestId, "requestId") ??
    validateIdentifier(message.contextId, "contextId") ??
    validatePositiveSafeInteger(message.contextRevision, "contextRevision") ??
    validateOrigin(message.origin, "origin")
  );
}
