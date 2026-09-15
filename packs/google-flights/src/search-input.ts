import type { JsonObject } from "@mcpatch/sdk/runtime";

const AIRPORT_CODE = /^[A-Z]{3}$/u;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const SEARCH_KEYS = Object.freeze([
  "destination",
  "origin",
  "outboundDate",
  "returnDate",
] as const);
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_ADVANCE_DAYS = 330;

export type GoogleFlightsSearchInputErrorReason =
  | "date_out_of_range"
  | "invalid_airport"
  | "invalid_arguments"
  | "invalid_date"
  | "invalid_date_range"
  | "same_airport";

/** Payload-free validation error safe to map onto the page protocol. */
export class GoogleFlightsSearchInputError extends Error {
  readonly reason: GoogleFlightsSearchInputErrorReason;

  constructor(reason: GoogleFlightsSearchInputErrorReason) {
    super(`Google Flights search input failed: ${reason}`);
    this.name = "GoogleFlightsSearchInputError";
    this.reason = reason;
  }
}

export interface GoogleFlightsSearchInput extends JsonObject {
  readonly origin: string;
  readonly destination: string;
  readonly outboundDate: string;
  readonly returnDate: string;
}

export function validateGoogleFlightsSearchInput(
  value: unknown,
  now: Date = new Date(),
): GoogleFlightsSearchInput {
  if (!isClosedDataObject(value)) invalid("invalid_arguments");
  const origin = value.origin;
  const destination = value.destination;
  if (
    typeof origin !== "string" ||
    typeof destination !== "string" ||
    !AIRPORT_CODE.test(origin) ||
    !AIRPORT_CODE.test(destination)
  ) {
    invalid("invalid_airport");
  }
  if (origin === destination) invalid("same_airport");

  const outboundDate = value.outboundDate;
  const returnDate = value.returnDate;
  if (typeof outboundDate !== "string" || typeof returnDate !== "string") {
    invalid("invalid_date");
  }
  const outbound = parseIsoDate(outboundDate);
  const returning = parseIsoDate(returnDate);
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  if (
    outbound <= today ||
    returning <= today ||
    outbound > today + MAX_ADVANCE_DAYS * DAY_MS ||
    returning > today + MAX_ADVANCE_DAYS * DAY_MS
  ) {
    invalid("date_out_of_range");
  }
  if (returning < outbound) invalid("invalid_date_range");

  return Object.freeze({ origin, destination, outboundDate, returnDate });
}

function isClosedDataObject(
  value: unknown,
): value is Record<(typeof SEARCH_KEYS)[number], unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  const keys = Reflect.ownKeys(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    keys.length === SEARCH_KEYS.length &&
    SEARCH_KEYS.every((key) => Object.hasOwn(value, key))
  );
}

function parseIsoDate(value: string): number {
  const match = ISO_DATE.exec(value);
  if (match === null) invalid("invalid_date");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  if (new Date(timestamp).toISOString().slice(0, 10) !== value) {
    invalid("invalid_date");
  }
  return timestamp;
}

function invalid(reason: GoogleFlightsSearchInputErrorReason): never {
  throw new GoogleFlightsSearchInputError(reason);
}
