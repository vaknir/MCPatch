import type {
  PageMessageSender,
  PageSenderIdentity,
} from "./page-context-model.js";

const DOCUMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_PAGE_URL_LENGTH = 8_192;

/** Converts browser-attested sender metadata into one canonical top-level identity. */
export function validatePageSender(
  sender: PageMessageSender | undefined,
  extensionId: string,
): PageSenderIdentity | undefined {
  if (
    sender?.id !== extensionId ||
    sender.frameId !== 0 ||
    sender.documentLifecycle !== "active" ||
    typeof sender.tab?.id !== "number" ||
    !Number.isSafeInteger(sender.tab.id) ||
    sender.tab.id < 0 ||
    sender.tab.id > 2_147_483_647 ||
    typeof sender.documentId !== "string" ||
    !DOCUMENT_ID.test(sender.documentId) ||
    typeof sender.url !== "string" ||
    sender.url.length > MAX_PAGE_URL_LENGTH ||
    typeof sender.origin !== "string"
  ) {
    return undefined;
  }
  try {
    const url = new URL(sender.url);
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.href !== sender.url ||
      url.origin !== sender.origin
    ) {
      return undefined;
    }
    return Object.freeze({
      tabId: sender.tab.id,
      documentId: sender.documentId,
      url: url.href,
      origin: url.origin,
    });
  } catch {
    return undefined;
  }
}
