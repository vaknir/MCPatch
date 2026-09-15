import { describe, expect, it, vi } from "vitest";

import {
  googleFlightsDateLabels,
  performGoogleFlightsSearch,
  type GoogleFlightsInteractionError,
  type GoogleFlightsSearchControls,
  type GoogleFlightsSearchInput,
} from "../src/index.js";

const INPUT: GoogleFlightsSearchInput = Object.freeze({
  origin: "LHR",
  destination: "CDG",
  outboundDate: "2026-10-27",
  returnDate: "2026-11-03",
});

describe("Google Flights reviewed search action", () => {
  it("uses one fixed interaction sequence and schedules submit last", async () => {
    const calls: string[] = [];
    const controls = fakeControls(calls);

    await performGoogleFlightsSearch(controls, INPUT, signal());

    expect(calls).toEqual([
      "airport:origin:LHR",
      "airport:destination:CDG",
      "date:outboundDate:2026-10-27",
      "date:returnDate:2026-11-03",
      "submit",
    ]);
  });

  it("stops before the next interaction when cancellation wins", async () => {
    const calls: string[] = [];
    const controller = new AbortController();
    const controls = fakeControls(calls, () => controller.abort());

    await expect(
      performGoogleFlightsSearch(controls, INPUT, controller.signal),
    ).rejects.toMatchObject({
      code: "CANCELLED",
      reason: "cancelled",
    } satisfies Partial<GoogleFlightsInteractionError>);
    expect(calls).toEqual(["airport:origin:LHR"]);
  });

  it("produces only the two reviewed English date labels", () => {
    expect(googleFlightsDateLabels("2026-10-27")).toEqual([
      "Tuesday, October 27, 2026",
      "Tuesday, October 27",
    ]);
  });
});

function fakeControls(
  calls: string[],
  afterOrigin?: () => void,
): GoogleFlightsSearchControls {
  return {
    async selectAirport(field, code) {
      calls.push(`airport:${field}:${code}`);
      if (field === "origin") afterOrigin?.();
    },
    async selectDate(field, date) {
      calls.push(`date:${field}:${date}`);
    },
    scheduleSubmit: vi.fn(() => calls.push("submit")),
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}
