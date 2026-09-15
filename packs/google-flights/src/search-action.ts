import { GoogleFlightsInteractionError } from "./model.js";
import type { GoogleFlightsSearchInput } from "./search-input.js";

export type AirportField = "destination" | "origin";
export type DateField = "outboundDate" | "returnDate";

/** Closed internal interface implemented only by the reviewed DOM adapter. */
export interface GoogleFlightsSearchControls {
  selectAirport(
    field: AirportField,
    airportCode: string,
    signal: AbortSignal,
  ): Promise<void>;
  selectDate(
    field: DateField,
    isoDate: string,
    signal: AbortSignal,
  ): Promise<void>;
  scheduleSubmit(signal: AbortSignal): void;
}

export async function performGoogleFlightsSearch(
  controls: GoogleFlightsSearchControls,
  input: GoogleFlightsSearchInput,
  signal: AbortSignal,
): Promise<void> {
  abortInteraction(signal);
  await controls.selectAirport("origin", input.origin, signal);
  abortInteraction(signal);
  await controls.selectAirport("destination", input.destination, signal);
  abortInteraction(signal);
  await controls.selectDate("outboundDate", input.outboundDate, signal);
  abortInteraction(signal);
  await controls.selectDate("returnDate", input.returnDate, signal);
  abortInteraction(signal);
  controls.scheduleSubmit(signal);
}

export function abortInteraction(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GoogleFlightsInteractionError("CANCELLED", "cancelled");
  }
}
