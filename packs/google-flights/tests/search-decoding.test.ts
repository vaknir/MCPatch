import { describe, expect, it } from "vitest";

import { decodeGoogleFlightsSearchUrl } from "../src/search-decoding.js";
import { createGoogleFlightsSearchUrl } from "../src/search-navigation.js";

const NOW = new Date("2026-09-16T00:00:00Z");
const INPUT = Object.freeze({
  origin: "LHR",
  destination: "CDG",
  outboundDate: "2026-10-27",
  returnDate: "2026-11-03",
});

describe("google flights search decoding", () => {
  it("round-trips the validated input through the encoded tfs value", () => {
    const url = createGoogleFlightsSearchUrl(INPUT, NOW);
    expect(decodeGoogleFlightsSearchUrl(url)).toEqual(INPUT);
  });

  it("pins the field numbers the encoder writes", () => {
    // A change to the encoder's protobuf shape has to change this test, so a
    // silent renumbering cannot reach a user who approved a different search.
    const url = createGoogleFlightsSearchUrl(INPUT, NOW);
    const tfs = new URL(url).searchParams.get("tfs");
    expect(tfs).toBeTypeOf("string");
    expect(
      url.startsWith("https://www.google.com/travel/flights/search?tfs="),
    ).toBe(true);
    expect(url.endsWith("&hl=en")).toBe(true);

    // Both legs decode, and the return leg mirrors the outbound one.
    const decoded = decodeGoogleFlightsSearchUrl(url);
    expect(decoded?.origin).toBe("LHR");
    expect(decoded?.destination).toBe("CDG");
    expect(decoded?.outboundDate).toBe("2026-10-27");
    expect(decoded?.returnDate).toBe("2026-11-03");
  });

  it("distinguishes a different search from the approved one", () => {
    const approved = createGoogleFlightsSearchUrl(INPUT, NOW);
    const other = createGoogleFlightsSearchUrl(
      { ...INPUT, destination: "AMS" },
      NOW,
    );
    expect(decodeGoogleFlightsSearchUrl(approved)).not.toEqual(
      decodeGoogleFlightsSearchUrl(other),
    );
  });

  it("returns nothing for a URL this encoder could not have produced", () => {
    for (const url of [
      "https://www.google.com/travel/flights/search",
      "https://www.google.com/travel/flights/search?tfs=not-base64!!",
      "https://www.google.com/travel/flights/search?tfs=AAAA",
      "not a url",
    ]) {
      expect(decodeGoogleFlightsSearchUrl(url)).toBeUndefined();
    }
  });
});
