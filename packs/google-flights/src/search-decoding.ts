import type { GoogleFlightsSearchInput } from "./search-input.js";

/**
 * Decodes the opaque `tfs` value the search action encodes.
 *
 * The encoder writes Google's protobuf shape with field numbers and constants
 * fixed by observation, so nothing guards that the encoded URL still means
 * what it meant if Google renumbers a field. Decoding it back gives two
 * things: a golden round-trip test that makes any change to the encoder
 * visible in review, and a way for the pack to check, after the page has
 * loaded, that the search the user approved is the search the page is showing.
 *
 * Returns `undefined` for anything that is not a `tfs` this encoder could have
 * produced, so a caller treats an unrecognised value as unknown rather than
 * as a match.
 */
export function decodeGoogleFlightsSearchUrl(
  url: string,
): GoogleFlightsSearchInput | undefined {
  const parameter = searchParameter(url);
  return parameter === undefined ? undefined : decodeSearch(parameter);
}

/** The `tfs` query parameter of a Google Flights search URL. */
function searchParameter(url: string): Uint8Array | undefined {
  let value: string | null;
  try {
    value = new URL(url).searchParams.get("tfs");
  } catch {
    return undefined;
  }
  return value === null ? undefined : decodeBase64Url(value);
}

/** The two legs an encoded round trip carries, read back as typed input. */
function decodeSearch(
  payload: Uint8Array,
): GoogleFlightsSearchInput | undefined {
  const legs = fieldsOf(payload)
    .filter((field) => field.number === 3 && field.wire === 2)
    .map((field) => decodeLeg(field.bytes));
  const [outbound, returning] = legs;
  if (legs.length !== 2 || outbound === undefined || returning === undefined) {
    return undefined;
  }
  if (
    outbound.origin !== returning.destination ||
    outbound.destination !== returning.origin
  ) {
    return undefined;
  }
  return Object.freeze({
    origin: outbound.origin,
    destination: outbound.destination,
    outboundDate: outbound.date,
    returnDate: returning.date,
  });
}

interface DecodedLeg {
  readonly date: string;
  readonly destination: string;
  readonly origin: string;
}

function decodeLeg(payload: Uint8Array): DecodedLeg | undefined {
  const fields = fieldsOf(payload);
  const date = textField(fields, 2);
  const origin = airportField(fields, 13);
  const destination = airportField(fields, 14);
  return date === undefined || origin === undefined || destination === undefined
    ? undefined
    : { date, destination, origin };
}

function airportField(
  fields: readonly ProtobufField[],
  number: number,
): string | undefined {
  const field = fields.find(
    (candidate) => candidate.number === number && candidate.wire === 2,
  );
  return field === undefined ? undefined : textField(fieldsOf(field.bytes), 2);
}

function textField(
  fields: readonly ProtobufField[],
  number: number,
): string | undefined {
  const field = fields.find(
    (candidate) => candidate.number === number && candidate.wire === 2,
  );
  return field === undefined
    ? undefined
    : new TextDecoder().decode(field.bytes);
}

interface ProtobufField {
  readonly bytes: Uint8Array;
  readonly number: number;
  readonly wire: number;
}

/** Top-level fields of one protobuf message, bounded by the input length. */
function fieldsOf(payload: Uint8Array): readonly ProtobufField[] {
  const fields: ProtobufField[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const tag = readVarint(payload, offset);
    if (tag === undefined) return fields;
    offset = tag.offset;
    const wire = Number(tag.value & 0x7n);
    const number = Number(tag.value >> 3n);
    if (wire === 0) {
      const value = readVarint(payload, offset);
      if (value === undefined) return fields;
      offset = value.offset;
      fields.push({ bytes: new Uint8Array(), number, wire });
      continue;
    }
    if (wire !== 2) return fields;
    const length = readVarint(payload, offset);
    if (length === undefined) return fields;
    const start = length.offset;
    const end = start + Number(length.value);
    if (end > payload.length) return fields;
    fields.push({ bytes: payload.subarray(start, end), number, wire });
    offset = end;
  }
  return fields;
}

function readVarint(
  payload: Uint8Array,
  start: number,
): { readonly offset: number; readonly value: bigint } | undefined {
  let value = 0n;
  let shift = 0n;
  let offset = start;
  while (offset < payload.length) {
    const byte = payload[offset];
    if (byte === undefined) return undefined;
    value |= BigInt(byte & 0x7f) << shift;
    offset += 1;
    if ((byte & 0x80) === 0) return { offset, value };
    shift += 7n;
    if (shift > 63n) return undefined;
  }
  return undefined;
}

function decodeBase64Url(value: string): Uint8Array | undefined {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = globalThis.atob(
      padded.padEnd(Math.ceil(padded.length / 4) * 4, "="),
    );
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
}
