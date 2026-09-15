import type { Message } from "./types/index.js";

export type NegotiationCode =
  | "INVALID_VERSION_SET"
  | "NEGOTIATION_FAILED"
  | "NO_COMMON_VERSION"
  | "UNEXPECTED_MESSAGE"
  | "UNEXPECTED_SELECTED_VERSION"
  | "VERSION_MISMATCH";

export class ProtocolNegotiationError extends Error {
  readonly code: NegotiationCode;

  constructor(code: NegotiationCode) {
    super(`protocol negotiation failed: ${code}`);
    this.name = "ProtocolNegotiationError";
    this.code = code;
  }
}

export type NegotiationPhase =
  | { readonly state: "ack_pending"; readonly protocolVersion: number }
  | { readonly state: "awaiting_hello" }
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly protocolVersion: number };

export type NegotiationEvent =
  | { readonly type: "message_accepted" }
  | {
      readonly type: "send_hello_ack";
      readonly selectedProtocolVersion: number;
    };

const MAX_ADVERTISED_VERSIONS = 16;
const MAX_PROTOCOL_VERSION = 2_147_483_647;

/** Stateful gate for validated messages on the accepting side of an authenticated connection. */
export class AcceptorNegotiation {
  readonly #localVersions: readonly number[];
  #phase: NegotiationPhase = { state: "awaiting_hello" };

  constructor(localVersions: readonly number[]) {
    validateVersionSet(localVersions);
    this.#localVersions = [...localVersions];
  }

  get phase(): NegotiationPhase {
    return this.#phase;
  }

  receive(message: Message): NegotiationEvent {
    if (this.#phase.state === "failed") {
      throw new ProtocolNegotiationError("NEGOTIATION_FAILED");
    }

    if (this.#phase.state === "awaiting_hello") {
      if (message.type !== "hello") return this.#fail("UNEXPECTED_MESSAGE");
      try {
        const selectedProtocolVersion = selectProtocolVersion(
          this.#localVersions,
          message.supportedProtocolVersions,
        );
        this.#phase = {
          state: "ack_pending",
          protocolVersion: selectedProtocolVersion,
        };
        return { type: "send_hello_ack", selectedProtocolVersion };
      } catch (error) {
        this.#phase = { state: "failed" };
        throw error;
      }
    }

    if (this.#phase.state === "ack_pending") {
      return this.#fail("UNEXPECTED_MESSAGE");
    }
    if (message.type === "hello" || message.type === "hello_ack") {
      return this.#fail("UNEXPECTED_MESSAGE");
    }
    if (message.protocolVersion !== this.#phase.protocolVersion) {
      return this.#fail("VERSION_MISMATCH");
    }
    return { type: "message_accepted" };
  }

  /** Mark the generated acknowledgement as delivered to the transport. */
  acknowledgementSent(): void {
    if (this.#phase.state !== "ack_pending") {
      return this.#fail("UNEXPECTED_MESSAGE");
    }
    this.#phase = {
      state: "ready",
      protocolVersion: this.#phase.protocolVersion,
    };
  }

  #fail(code: NegotiationCode): never {
    this.#phase = { state: "failed" };
    throw new ProtocolNegotiationError(code);
  }
}

/** Select the highest version both peers advertised. */
export function selectProtocolVersion(
  localVersions: readonly number[],
  remoteVersions: readonly number[],
): number {
  validateVersionSet(localVersions);
  validateVersionSet(remoteVersions);

  const remote = new Set(remoteVersions);
  const common = localVersions.filter((version) => remote.has(version));
  if (common.length === 0) {
    throw new ProtocolNegotiationError("NO_COMMON_VERSION");
  }
  return Math.max(...common);
}

/** Reject unoffered acknowledgements and downgrade selections. */
export function verifySelectedVersion(
  initiatorVersions: readonly number[],
  acceptorVersions: readonly number[],
  selectedVersion: number,
): void {
  const expected = selectProtocolVersion(initiatorVersions, acceptorVersions);
  if (selectedVersion !== expected) {
    throw new ProtocolNegotiationError("UNEXPECTED_SELECTED_VERSION");
  }
}

function validateVersionSet(versions: readonly number[]): void {
  if (
    versions.length < 1 ||
    versions.length > MAX_ADVERTISED_VERSIONS ||
    new Set(versions).size !== versions.length ||
    versions.some(
      (version) =>
        !Number.isInteger(version) ||
        version < 1 ||
        version > MAX_PROTOCOL_VERSION,
    )
  ) {
    throw new ProtocolNegotiationError("INVALID_VERSION_SET");
  }
}
