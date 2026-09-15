import { describe, expect, it, vi } from "vitest";

import {
  createGoogleFlightsDocumentSource,
  createGoogleFlightsSearchUrl,
  scheduleGoogleFlightsSearch,
  type GoogleFlightsInteractionError,
  type GoogleFlightsSearchInput,
  type GoogleFlightsSearchNavigation,
} from "../src/index.js";

const INPUT: GoogleFlightsSearchInput = Object.freeze({
  origin: "LHR",
  destination: "CDG",
  outboundDate: "2026-10-30",
  returnDate: "2026-11-07",
});
const CAPTURE_DATE = new Date("2026-09-15T00:00:00Z");
const CAPTURED_SEARCH_URL =
  "https://www.google.com/travel/flights/search?tfs=CBwQAhoeEgoyMDI2LTEwLTMwagcIARIDTEhScgcIARIDQ0RHGh4SCjIwMjYtMTEtMDdqBwgBEgNDREdyBwgBEgNMSFJAAUgBcAGCAQsI____________AZgBAQ&hl=en";

describe("Google Flights reviewed search navigation", () => {
  it("matches the signed-out public form's captured search URL", () => {
    expect(createGoogleFlightsSearchUrl(INPUT, CAPTURE_DATE)).toBe(
      CAPTURED_SEARCH_URL,
    );
  });

  it("encodes only validated values into the exact Google Flights path", () => {
    const url = new URL(createGoogleFlightsSearchUrl(INPUT, CAPTURE_DATE));

    expect(url.origin).toBe("https://www.google.com");
    expect(url.pathname).toBe("/travel/flights/search");
    expect([...url.searchParams.keys()]).toEqual(["tfs", "hl"]);
    expect(url.searchParams.get("hl")).toBe("en");
    expect(url.searchParams.get("tfs")).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(url.href).not.toContain("cookie");
    expect(url.href).not.toContain("token");
  });

  it("schedules one navigation without exposing a generic browser primitive", () => {
    const schedule = vi.fn();
    const navigation: GoogleFlightsSearchNavigation = { schedule };

    scheduleGoogleFlightsSearch(navigation, INPUT, signal());

    expect(schedule).toHaveBeenCalledOnce();
    expect(schedule).toHaveBeenCalledWith(CAPTURED_SEARCH_URL);
  });

  it("connects the document source action directly to the bounded navigator", async () => {
    const schedule = vi.fn();
    const source = createGoogleFlightsDocumentSource(
      { nodeType: 9 } as Document,
      { schedule },
    );

    await source.search?.(INPUT, signal());

    expect(schedule).toHaveBeenCalledWith(CAPTURED_SEARCH_URL);
  });

  it("fails before navigation when cancellation wins", () => {
    const controller = new AbortController();
    controller.abort();
    const navigation: GoogleFlightsSearchNavigation = { schedule: vi.fn() };

    expect(() =>
      scheduleGoogleFlightsSearch(navigation, INPUT, controller.signal),
    ).toThrowError(
      expect.objectContaining({
        code: "CANCELLED",
        reason: "cancelled",
      }) as GoogleFlightsInteractionError,
    );
    expect(navigation.schedule).not.toHaveBeenCalled();
  });

  it("rejects malformed arguments before encoding", () => {
    expect(() =>
      createGoogleFlightsSearchUrl(
        { ...INPUT, destination: "https://evil.example" },
        CAPTURE_DATE,
      ),
    ).toThrowError(expect.objectContaining({ reason: "invalid_airport" }));
  });
});

function signal(): AbortSignal {
  return new AbortController().signal;
}
