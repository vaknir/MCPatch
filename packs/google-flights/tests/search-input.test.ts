import { describe, expect, it } from "vitest";

import {
  type GoogleFlightsSearchInputError,
  validateGoogleFlightsSearchInput,
} from "../src/search-input.js";

const NOW = new Date("2026-09-15T12:00:00Z");
const VALID = Object.freeze({
  origin: "LHR",
  destination: "CDG",
  outboundDate: "2026-10-27",
  returnDate: "2026-11-03",
});

describe("Google Flights search input", () => {
  it("accepts one closed airport-code round trip", () => {
    expect(validateGoogleFlightsSearchInput(VALID, NOW)).toEqual(VALID);
  });

  it.each([
    [{ ...VALID, origin: "London" }, "invalid_airport"],
    [{ ...VALID, destination: "cdg" }, "invalid_airport"],
    [{ ...VALID, destination: "LHR" }, "same_airport"],
    [{ ...VALID, outboundDate: "2026-02-30" }, "invalid_date"],
    [{ ...VALID, outboundDate: "2026-09-15" }, "date_out_of_range"],
    [
      { ...VALID, outboundDate: "2026-11-03", returnDate: "2026-10-27" },
      "invalid_date_range",
    ],
    [{ ...VALID, returnDate: "2027-08-13" }, "date_out_of_range"],
    [{ ...VALID, selector: "button" }, "invalid_arguments"],
  ])("rejects invalid or widened input %#", (input, reason) => {
    expect(() => validateGoogleFlightsSearchInput(input, NOW)).toThrowError(
      expect.objectContaining({
        name: "GoogleFlightsSearchInputError",
        reason,
      }) as GoogleFlightsSearchInputError,
    );
  });

  it("rejects arrays and class instances instead of treating them as data", () => {
    class SearchInput {
      origin = "LHR";
      destination = "CDG";
      outboundDate = "2026-10-27";
      returnDate = "2026-11-03";
    }

    for (const input of [null, [], new SearchInput()]) {
      expect(() => validateGoogleFlightsSearchInput(input, NOW)).toThrowError(
        expect.objectContaining({ reason: "invalid_arguments" }) as Error,
      );
    }
  });
});
