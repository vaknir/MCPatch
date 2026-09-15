import { GoogleFlightsInteractionError } from "./model.js";
import {
  type GoogleFlightsSearchInput,
  validateGoogleFlightsSearchInput,
} from "./search-input.js";

const SEARCH_MODE = 2n;
const ROUND_TRIP = 1n;
const ONE_ADULT = 1n;
const ECONOMY = 1n;
const ANY_AIRLINE = 0xffff_ffff_ffff_ffffn;

/** Narrow browser primitive used by the reviewed search action. */
export interface GoogleFlightsSearchNavigation {
  schedule(url: string): void;
}

/**
 * Builds the exact Google Flights search URL observed from its public form.
 * The opaque `tfs` value is encoded locally from validated typed arguments;
 * captured cookies, request headers, and session identifiers are never used.
 */
export function createGoogleFlightsSearchUrl(
  value: unknown,
  now: Date = new Date(),
): string {
  const input = validateGoogleFlightsSearchInput(value, now);
  const query = base64Url(encodeSearch(input));
  return `https://www.google.com/travel/flights/search?tfs=${query}&hl=en`;
}

/** Schedules navigation after the MCP result has had a chance to flush. */
export function scheduleGoogleFlightsSearch(
  navigation: GoogleFlightsSearchNavigation,
  input: GoogleFlightsSearchInput,
  signal: AbortSignal,
): void {
  abortInteraction(signal);
  if (typeof navigation?.schedule !== "function") {
    throw new GoogleFlightsInteractionError(
      "INCOMPATIBLE",
      "navigation_unavailable",
    );
  }
  navigation.schedule(createGoogleFlightsSearchUrl(input));
}

function encodeSearch(input: GoogleFlightsSearchInput): Uint8Array {
  const outbound = encodeLeg(
    input.outboundDate,
    input.origin,
    input.destination,
  );
  const returning = encodeLeg(
    input.returnDate,
    input.destination,
    input.origin,
  );
  return message([
    varintField(1, 28n),
    varintField(2, SEARCH_MODE),
    messageField(3, outbound),
    messageField(3, returning),
    varintField(8, ROUND_TRIP),
    varintField(9, ONE_ADULT),
    varintField(14, ECONOMY),
    messageField(16, message([varintField(1, ANY_AIRLINE)])),
    varintField(19, 1n),
  ]);
}

function encodeLeg(
  date: string,
  origin: string,
  destination: string,
): Uint8Array {
  return message([
    stringField(2, date),
    messageField(13, encodeAirport(origin)),
    messageField(14, encodeAirport(destination)),
  ]);
}

function encodeAirport(code: string): Uint8Array {
  return message([varintField(1, 1n), stringField(2, code)]);
}

function stringField(field: number, value: string): Uint8Array {
  return messageField(field, new TextEncoder().encode(value));
}

function messageField(field: number, value: Uint8Array): Uint8Array {
  return message([
    encodeVarint(BigInt((field << 3) | 2)),
    encodeVarint(BigInt(value.length)),
    value,
  ]);
}

function varintField(field: number, value: bigint): Uint8Array {
  return message([encodeVarint(BigInt(field << 3)), encodeVarint(value)]);
}

function encodeVarint(value: bigint): Uint8Array {
  const bytes: number[] = [];
  let remaining = value;
  do {
    const byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    bytes.push(remaining === 0n ? byte : byte | 0x80);
  } while (remaining !== 0n);
  return Uint8Array.from(bytes);
}

function message(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_")
    .replace(/=+$/gu, "");
}

function abortInteraction(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new GoogleFlightsInteractionError("CANCELLED", "cancelled");
  }
}
