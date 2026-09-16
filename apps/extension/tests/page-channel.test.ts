import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  encodePageToWorkerMessage,
  encodeWorkerToPageMessage,
  MAX_PAGE_FRAME_BYTES,
  PageProtocolValidationError,
  parsePageToWorkerFrame,
  parseWorkerToPageFrame,
  type PageToWorkerMessage,
  type WorkerToPageMessage,
} from "../src/page-channel.js";

const fixtureRoot = new URL("../fixtures/page-channel/v2/", import.meta.url);
const pageToWorker = readJson("valid/page-to-worker.json") as unknown[];
const workerToPage = readJson("valid/worker-to-page.json") as unknown[];
const invalidCases = readJson("invalid/cases.json") as Array<{
  readonly file: string;
  readonly direction: "page_to_worker" | "worker_to_page";
  readonly code: PageProtocolValidationError["code"];
}>;

describe("page-channel protocol", () => {
  it("round-trips every valid golden message in its exact direction", () => {
    for (const message of pageToWorker) {
      const frame = encodePageToWorkerMessage(message as PageToWorkerMessage);
      expect(parsePageToWorkerFrame(frame)).toEqual(message);
    }
    for (const message of workerToPage) {
      const frame = encodeWorkerToPageMessage(message as WorkerToPageMessage);
      expect(parseWorkerToPageFrame(frame)).toEqual(message);
    }
  });

  it.each(invalidCases)(
    "rejects invalid fixture $file with $code",
    ({ file, direction, code }) => {
      const frame = readText(`invalid/${file}`);
      expectCode(
        () =>
          direction === "page_to_worker"
            ? parsePageToWorkerFrame(frame)
            : parseWorkerToPageFrame(frame),
        code,
      );
    },
  );

  it("rejects non-text and oversized frames before parsing", () => {
    expectCode(() => parsePageToWorkerFrame({}), "INVALID_TYPE");
    const oversized = `"${"x".repeat(MAX_PAGE_FRAME_BYTES)}"`;
    expectCode(() => parsePageToWorkerFrame(oversized), "LIMIT_EXCEEDED");
  });

  it("rejects accessors during encoding without invoking them", () => {
    let accessed = false;
    const message = structuredClone(pageToWorker[0]) as Record<string, unknown>;
    Object.defineProperty(message, "implementation", {
      enumerable: true,
      get() {
        accessed = true;
        return { name: "unsafe", version: "0.1.0" };
      },
    });

    expectCode(
      () =>
        encodePageToWorkerMessage(message as unknown as PageToWorkerMessage),
      "INVALID_VALUE",
    );
    expect(accessed).toBe(false);
  });

  it("rejects sparse arrays and non-JSON whitespace", () => {
    const message = structuredClone(pageToWorker[0]) as Record<string, unknown>;
    message.supportedPageProtocolVersions = new Array(1);
    expectCode(
      () =>
        encodePageToWorkerMessage(message as unknown as PageToWorkerMessage),
      "INVALID_VALUE",
    );
    expectCode(
      () => parsePageToWorkerFrame(`\u00a0${JSON.stringify(pageToWorker[0])}`),
      "MALFORMED_JSON",
    );
  });

  it("accepts one bounded image and rejects malformed page media", () => {
    const result = structuredClone(pageToWorker[2]) as Record<string, unknown>;
    result.content = [
      {
        type: "image",
        mimeType: "image/webp",
        data: "UklGRg==",
        width: 2,
        height: 1,
      },
    ];
    expect(() =>
      encodePageToWorkerMessage(result as unknown as PageToWorkerMessage),
    ).not.toThrow();

    const malformed = structuredClone(result) as {
      content: Array<{ data: string }>;
    };
    const image = malformed.content[0];
    if (image === undefined) throw new Error("missing image fixture");
    image.data = "not base64";
    expectCode(
      () =>
        encodePageToWorkerMessage(malformed as unknown as PageToWorkerMessage),
      "INVALID_VALUE",
    );
  });

  it("requires read-only native metadata and rejects duplicate source identities", () => {
    const snapshot = structuredClone(pageToWorker[1]) as {
      capabilities: Array<Record<string, unknown>>;
    };
    const native = snapshot.capabilities[1];
    if (native === undefined) throw new Error("missing native fixture");
    native.annotations = {
      readOnlyHint: false,
      consequentialHint: false,
      untrustedContentHint: true,
    };
    expectCode(
      () =>
        encodePageToWorkerMessage(snapshot as unknown as PageToWorkerMessage),
      "INVALID_VALUE",
    );

    const duplicate = structuredClone(pageToWorker[1]) as {
      capabilities: Array<Record<string, unknown>>;
    };
    const first = duplicate.capabilities[0];
    if (first === undefined) throw new Error("missing pack fixture");
    duplicate.capabilities.push(structuredClone(first));
    expectCode(
      () =>
        encodePageToWorkerMessage(duplicate as unknown as PageToWorkerMessage),
      "INVALID_VALUE",
    );
  });

  it("allows one native and one pack candidate with the same logical name", () => {
    const snapshot = structuredClone(pageToWorker[1]) as {
      capabilities: Array<Record<string, unknown>>;
    };
    const pack = snapshot.capabilities[0];
    const native = snapshot.capabilities[1];
    if (pack === undefined || native === undefined) {
      throw new Error("missing capability fixtures");
    }
    native.name = pack.name;

    expect(() =>
      encodePageToWorkerMessage(snapshot as unknown as PageToWorkerMessage),
    ).not.toThrow();
  });

  it("returns deeply frozen detached protocol data", () => {
    const parsed = parsePageToWorkerFrame(JSON.stringify(pageToWorker[1]));

    expect(Object.isFrozen(parsed)).toBe(true);
    if (parsed.type !== "page_capability_snapshot") {
      throw new Error("unexpected fixture type");
    }
    expect(Object.isFrozen(parsed.capabilities)).toBe(true);
    expect(Object.isFrozen(parsed.capabilities[0])).toBe(true);
  });
});

function readJson(path: string): unknown {
  return JSON.parse(readText(path)) as unknown;
}

function readText(path: string): string {
  return readFileSync(new URL(path, fixtureRoot), "utf8");
}

function expectCode(
  operation: () => unknown,
  code: PageProtocolValidationError["code"],
): void {
  try {
    operation();
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(PageProtocolValidationError);
    expect((error as PageProtocolValidationError).code).toBe(code);
    return;
  }
  throw new Error(`expected page protocol error ${code}`);
}
