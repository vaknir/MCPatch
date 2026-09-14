import { describe, expect, it } from "vitest";

import {
  parseMessage,
  ProtocolValidationError,
  validateMessage,
  validationIssue,
} from "../src/index.js";
import {
  fixtureNames,
  invalidDirectory,
  readFixture,
  validDirectory,
} from "./fixture-helpers.js";

const validFixtures = fixtureNames(validDirectory);
const invalidFixtures = fixtureNames(invalidDirectory);

describe("TypeScript protocol runtime validation", () => {
  it.each(validFixtures)("accepts %s", (name) => {
    expect(validateMessage(readFixture(validDirectory, name))).toBe(true);
  });

  it.each(invalidFixtures)("rejects %s", (name) => {
    expect(validateMessage(readFixture(invalidDirectory, name))).toBe(false);
  });

  it("returns a typed message or throws a stable validation error", () => {
    const valid = parseMessage(readFixture(validDirectory, "tool-call.json"));
    expect(valid.type).toBe("tool_call");

    expect(() =>
      parseMessage(readFixture(invalidDirectory, "unknown-field.json")),
    ).toThrow(ProtocolValidationError);
    expect(
      validationIssue(readFixture(invalidDirectory, "unknown-field.json")),
    ).toEqual({ code: "UNKNOWN_FIELD", field: "$.executeAnyway" });
  });

  it("accepts a bootstrap hello from an incompatible peer", () => {
    const hello = readFixture(validDirectory, "hello.json") as {
      supportedProtocolVersions: number[];
    };
    hello.supportedProtocolVersions = [2];
    expect(validateMessage(hello)).toBe(true);
  });

  it("rejects noncanonical origins even when they are valid URLs", () => {
    const call = readFixture(validDirectory, "tool-call.json") as {
      origin: string;
    };
    call.origin = "https://www.google.com:443";
    expect(validationIssue(call)).toEqual({
      code: "INVALID_ORIGIN",
      field: "origin",
    });
  });

  it("rejects duplicate capability names", () => {
    const snapshot = readFixture(
      validDirectory,
      "capability-snapshot.json",
    ) as {
      capabilities: Array<Record<string, unknown>>;
    };
    const duplicate = structuredClone(snapshot.capabilities[0]);
    if (duplicate === undefined) throw new Error("fixture capability missing");
    duplicate.description = "A different implementation with the same name.";
    snapshot.capabilities.push(duplicate);

    expect(validationIssue(snapshot)).toEqual({
      code: "INVALID_CAPABILITY",
      field: "capabilities[2].name",
    });
  });

  it("enforces strict SemVer for pack references", () => {
    const snapshot = readFixture(
      validDirectory,
      "capability-snapshot.json",
    ) as {
      capabilities: Array<{ pack?: { version: string } }>;
    };
    const pack = snapshot.capabilities[0]?.pack;
    if (pack === undefined) throw new Error("fixture pack missing");
    pack.version = "1.0.0-01";

    expect(validationIssue(snapshot)).toEqual({
      code: "INVALID_VALUE",
      field: "capabilities[0].pack.version",
    });
  });

  it("rejects invalid calendar timestamps", () => {
    const heartbeat = readFixture(validDirectory, "heartbeat.json") as {
      sentAt: string;
    };
    heartbeat.sentAt = "2026-02-30T12:00:00Z";
    expect(validateMessage(heartbeat)).toBe(false);
  });

  it("rejects cyclic values that JSON cannot encode", () => {
    const result = readFixture(validDirectory, "tool-result.json") as {
      result: unknown;
    };
    result.result = result;
    expect(validateMessage(result)).toBe(false);
  });

  it("rejects class instances that are not decoded JSON objects", () => {
    const result = readFixture(validDirectory, "tool-result.json") as {
      result: unknown;
    };
    result.result = new Date("2026-09-15T12:00:00Z");
    expect(validateMessage(result)).toBe(false);
  });

  it("fails closed when an untrusted object throws during inspection", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("untrusted getter");
        },
      },
    );
    expect(validateMessage(hostile)).toBe(false);
    expect(() => parseMessage(hostile)).toThrow(ProtocolValidationError);
  });
});
