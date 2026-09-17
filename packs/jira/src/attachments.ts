import {
  JIRA_FINGERPRINT,
  type JiraAttachment,
  type JiraGetIssueInput,
  type JiraListAttachmentsResult,
} from "./model.js";
import {
  optionalResponseUser,
  responseArray,
  responseCount,
  responseField,
  responseId,
  responseObject,
} from "./response.js";
import type { JiraRestClient } from "./rest.js";
import {
  JIRA_ISSUE_KEY,
  JIRA_NUMERIC_ID,
  closedInput,
  dataValue,
  requiredPattern,
} from "./validation.js";

const MAX_ATTACHMENTS = 128;
const MAX_FILENAME_LENGTH = 255;
const MAX_SIZE_BYTES = 1_000_000_000_000;
const MAX_TIMESTAMP_LENGTH = 64;

export function validateJiraListAttachmentsInput(
  value: unknown,
): JiraGetIssueInput {
  const source = closedInput(value, ["issueKey"], ["issueKey"]);
  return Object.freeze({
    issueKey: requiredPattern(
      dataValue(source, "issueKey"),
      JIRA_ISSUE_KEY,
      21,
    ),
  });
}

/**
 * Reports what is attached, never the bytes. Transferring arbitrary file
 * content across MCP is a separate capability class from typed field reads and
 * would need its own reviewed contract and size/type boundary.
 */
export async function listJiraAttachments(
  client: JiraRestClient,
  value: unknown,
  signal: AbortSignal,
): Promise<JiraListAttachmentsResult> {
  const input = validateJiraListAttachmentsInput(value);
  const decoded = await client.get(
    `/issue/${input.issueKey}`,
    { fields: "attachment" },
    signal,
  );
  const fields = responseObject(dataValue(responseObject(decoded), "fields"));
  const attachments = dataValue(fields, "attachment");
  return Object.freeze({
    fingerprint: JIRA_FINGERPRINT,
    issueKey: input.issueKey,
    attachments: Object.freeze(
      attachments === undefined || attachments === null
        ? []
        : responseArray(attachments, MAX_ATTACHMENTS).map(parseJiraAttachment),
    ),
  });
}

export function parseJiraAttachment(value: unknown): JiraAttachment {
  const attachment = responseObject(value);
  const author = optionalResponseUser(dataValue(attachment, "author"));
  return Object.freeze({
    id: responseId(dataValue(attachment, "id"), JIRA_NUMERIC_ID),
    filename: responseField(attachment, "filename", MAX_FILENAME_LENGTH),
    mimeType: responseField(attachment, "mimeType", 255),
    sizeBytes: responseCount(dataValue(attachment, "size"), MAX_SIZE_BYTES),
    created: responseField(attachment, "created", MAX_TIMESTAMP_LENGTH),
    ...(author === undefined ? {} : { author }),
  });
}
