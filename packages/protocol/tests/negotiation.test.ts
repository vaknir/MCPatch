import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  AcceptorNegotiation,
  parseMessage,
  ProtocolNegotiationError,
  selectProtocolVersion,
  verifySelectedVersion,
} from "../src/index.js";
import { readFixture, validDirectory } from "./fixture-helpers.js";

interface NegotiationCase {
  name: string;
  local: number[];
  remote: number[];
  selected?: number;
  error?: string;
}

interface NegotiationFixture {
  cases: NegotiationCase[];
}

const fixturePath = new URL(
  "../fixtures/negotiation/cases.json",
  import.meta.url,
);
const fixture = JSON.parse(
  readFileSync(fixturePath, "utf8"),
) as NegotiationFixture;

describe("protocol version negotiation", () => {
  it.each(fixture.cases)("$name", (testCase) => {
    if (testCase.selected !== undefined) {
      expect(selectProtocolVersion(testCase.local, testCase.remote)).toBe(
        testCase.selected,
      );
      return;
    }

    try {
      selectProtocolVersion(testCase.local, testCase.remote);
      throw new Error("expected negotiation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ProtocolNegotiationError);
      expect((error as ProtocolNegotiationError).code).toBe(testCase.error);
    }
  });

  it("rejects downgraded and unoffered acknowledgements", () => {
    expect(() => verifySelectedVersion([1, 2], [1, 2], 2)).not.toThrow();
    expectNegotiationCode(
      () => verifySelectedVersion([1, 2], [1, 2], 1),
      "UNEXPECTED_SELECTED_VERSION",
    );
    expectNegotiationCode(
      () => verifySelectedVersion([1], [1], 2),
      "UNEXPECTED_SELECTED_VERSION",
    );
  });

  it("verifies the selection against the acceptor set carried by hello_ack", () => {
    const acknowledgement = parseMessage(
      readFixture(validDirectory, "hello-ack.json"),
    );
    if (acknowledgement.type !== "hello_ack") {
      throw new Error("fixture must be hello_ack");
    }
    expect(() =>
      verifySelectedVersion(
        [2],
        acknowledgement.supportedProtocolVersions,
        acknowledgement.selectedProtocolVersion,
      ),
    ).not.toThrow();

    expectNegotiationCode(
      () => verifySelectedVersion([1, 2], [1, 2], 1),
      "UNEXPECTED_SELECTED_VERSION",
    );
    expectNegotiationCode(
      () => verifySelectedVersion([1], [1], 2),
      "UNEXPECTED_SELECTED_VERSION",
    );
  });

  it("gates application messages until hello", () => {
    const negotiation = new AcceptorNegotiation([2]);
    const cancel = parseMessage(readFixture(validDirectory, "cancel.json"));
    expectNegotiationCode(
      () => negotiation.receive(cancel),
      "UNEXPECTED_MESSAGE",
    );
    expect(negotiation.phase).toEqual({ state: "failed" });
  });

  it("accepts application messages after selecting a version", () => {
    const negotiation = new AcceptorNegotiation([2]);
    const hello = parseMessage(readFixture(validDirectory, "hello.json"));
    const cancel = parseMessage(readFixture(validDirectory, "cancel.json"));

    expect(negotiation.receive(hello)).toEqual({
      type: "send_hello_ack",
      selectedProtocolVersion: 2,
    });
    expect(negotiation.phase).toEqual({
      state: "ack_pending",
      protocolVersion: 2,
    });
    negotiation.acknowledgementSent();
    expect(negotiation.phase).toEqual({
      state: "ready",
      protocolVersion: 2,
    });
    expect(negotiation.receive(cancel)).toEqual({ type: "message_accepted" });
  });

  it("gates application messages until acknowledgement delivery", () => {
    const negotiation = new AcceptorNegotiation([2]);
    const hello = parseMessage(readFixture(validDirectory, "hello.json"));
    const cancel = parseMessage(readFixture(validDirectory, "cancel.json"));
    negotiation.receive(hello);

    expectNegotiationCode(
      () => negotiation.receive(cancel),
      "UNEXPECTED_MESSAGE",
    );
    expect(negotiation.phase).toEqual({ state: "failed" });
  });
});

function expectNegotiationCode(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error("expected negotiation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(ProtocolNegotiationError);
    expect((error as ProtocolNegotiationError).code).toBe(code);
  }
}
