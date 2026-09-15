import { describe, expect, it } from "vitest";

import { collectResultSemantics } from "../src/dom-results.js";

describe("Google Flights DOM results", () => {
  it("normalizes the live result-count announcement with terminal punctuation", () => {
    const document = {
      querySelectorAll: () => [],
    } as unknown as Document;

    expect(
      collectResultSemantics(
        document,
        [],
        [{ visible: true, text: "16 results returned." }],
        [{ visible: true, text: "Search results" }],
        new AbortController().signal,
      )?.counts,
    ).toEqual([{ visible: true, text: "16 results returned" }]);
  });
});
