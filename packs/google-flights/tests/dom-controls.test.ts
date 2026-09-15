import { describe, expect, it } from "vitest";

import { normalizePassengerAccessibleName } from "../src/dom-controls.js";

describe("Google Flights DOM controls", () => {
  it("keeps only the passenger count from the reviewed accessible-name grammar", () => {
    expect(normalizePassengerAccessibleName("1 passenger")).toBe("1 passenger");
    expect(
      normalizePassengerAccessibleName(
        "2 passengers, change number of passengers.",
      ),
    ).toBe("2 passengers");
  });

  it("rejects unrelated or unbounded passenger labels", () => {
    expect(normalizePassengerAccessibleName("Passengers")).toBe("");
    expect(normalizePassengerAccessibleName("100 passengers")).toBe("");
    expect(normalizePassengerAccessibleName("1 passenger seat offer")).toBe("");
  });
});
