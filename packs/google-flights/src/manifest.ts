import { MCPatch } from "@mcpatch/sdk/browser";

import {
  createGoogleFlightsPageAdapter,
  type GoogleFlightsPageAdapter,
} from "./adapter.js";
import {
  createGoogleFlightsDocumentSource,
  createGrantedSearchNavigation,
} from "./document-source.js";

import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_PRICE_INSIGHTS,
  FLIGHTS_RESULTS,
  FLIGHTS_SEARCH,
  GOOGLE_FLIGHTS_FINGERPRINT,
  GOOGLE_FLIGHTS_LANDING_PATH,
  GOOGLE_FLIGHTS_ORIGIN,
  GOOGLE_FLIGHTS_SEARCH_PATH,
  type CurrentSearchResult,
  type FlightResultsResult,
  type PriceInsightsResult,
  type SearchAcceptedResult,
} from "./model.js";

const EMPTY_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  maxProperties: 0,
  properties: {},
} as const;

const DISPLAY = { type: "string", maxLength: 256 } as const;
const NONEMPTY_DISPLAY = {
  type: "string",
  minLength: 1,
  maxLength: 256,
} as const;
const FINGERPRINT = {
  type: "string",
  const: GOOGLE_FLIGHTS_FINGERPRINT,
} as const;

const AIRPORT_CODE = { type: "string", minLength: 3, maxLength: 3 } as const;
const ISO_DATE = { type: "string", minLength: 10, maxLength: 10 } as const;

const mcp = new MCPatch<GoogleFlightsPageAdapter>({
  publisher: "flights",
  id: "google-flights",
  name: "Google Flights",
  description:
    "Reviewed bounded reads and one approved round-trip search action on compatible Google Flights pages.",
  version: "0.2.1",
  digest:
    "sha256:86d045a8ad5f247a84deb08392f44e392b59782115013c57f601fba47bd8ff02",
  matches: [
    {
      origin: GOOGLE_FLIGHTS_ORIGIN,
      paths: [
        { kind: "exact", path: GOOGLE_FLIGHTS_LANDING_PATH },
        { kind: "exact", path: GOOGLE_FLIGHTS_SEARCH_PATH },
      ],
    },
  ],
});

mcp.tool(
  {
    name: FLIGHTS_CURRENT_SEARCH,
    title: "Current Google Flights search",
    description:
      "Read bounded, visible search-form state from the current compatible Google Flights page.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "fingerprint",
        "path",
        "tripType",
        "cabinClass",
        "passengers",
        "origin",
        "destination",
        "departure",
      ],
      properties: {
        fingerprint: FINGERPRINT,
        path: { type: "string", enum: ["landing", "search"] },
        tripType: { type: "string", enum: ["one_way", "round_trip"] },
        cabinClass: {
          type: "string",
          enum: ["economy", "premium_economy", "business", "first"],
        },
        passengers: { type: "string", minLength: 1, maxLength: 64 },
        origin: DISPLAY,
        destination: DISPLAY,
        departure: DISPLAY,
        return: DISPLAY,
      },
    },
  },
  async (input, { site, signal }) =>
    (await site.execute(
      FLIGHTS_CURRENT_SEARCH,
      input,
      signal,
    )) as unknown as CurrentSearchResult,
);

mcp.tool(
  {
    name: FLIGHTS_SEARCH,
    title: "Search Google Flights",
    description:
      "Open one adult economy round-trip results for exact IATA airport codes in the current compatible Google Flights tab.",
    risk: "action",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 4,
      required: ["origin", "destination", "outboundDate", "returnDate"],
      properties: {
        origin: AIRPORT_CODE,
        destination: AIRPORT_CODE,
        outboundDate: ISO_DATE,
        returnDate: ISO_DATE,
      },
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state"],
      properties: {
        fingerprint: FINGERPRINT,
        state: { type: "string", const: "accepted" },
      },
    },
  },
  async (input, { site, signal }) =>
    (await site.execute(
      FLIGHTS_SEARCH,
      input,
      signal,
    )) as unknown as SearchAcceptedResult,
);

mcp.tool(
  {
    name: FLIGHTS_RESULTS,
    title: "Visible Google Flights results",
    description:
      "Read at most 20 complete, visible flight summaries from the current compatible results page.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state", "offers"],
      properties: {
        fingerprint: FINGERPRINT,
        state: {
          type: "string",
          enum: ["loading", "ready", "empty", "error"],
        },
        reportedCount: { type: "integer", minimum: 1, maximum: 9_999 },
        offers: {
          type: "array",
          maxItems: 20,
          items: {
            type: "object",
            additionalProperties: false,
            required: [
              "rank",
              "summary",
              "price",
              "priceScope",
              "stops",
              "carrier",
              "departure",
              "arrival",
              "duration",
              "caveats",
            ],
            properties: {
              rank: { type: "integer", minimum: 1, maximum: 20 },
              summary: { type: "string", minLength: 1, maxLength: 1_024 },
              price: NONEMPTY_DISPLAY,
              priceScope: {
                type: "string",
                enum: ["one way total", "round trip total"],
              },
              stops: NONEMPTY_DISPLAY,
              carrier: NONEMPTY_DISPLAY,
              departure: NONEMPTY_DISPLAY,
              arrival: NONEMPTY_DISPLAY,
              duration: NONEMPTY_DISPLAY,
              emissions: NONEMPTY_DISPLAY,
              caveats: {
                type: "array",
                maxItems: 4,
                items: NONEMPTY_DISPLAY,
              },
            },
          },
        },
      },
    },
  },
  async (input, { site, signal }) =>
    (await site.execute(
      FLIGHTS_RESULTS,
      input,
      signal,
    )) as unknown as FlightResultsResult,
);

mcp.tool(
  {
    name: FLIGHTS_PRICE_INSIGHTS,
    title: "Google Flights price insight",
    description:
      "Read the bounded short assessment visible in the current Google Flights price-insight region.",
    risk: "read",
    inputSchema: EMPTY_INPUT_SCHEMA,
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["fingerprint", "state"],
      properties: {
        fingerprint: FINGERPRINT,
        state: {
          type: "string",
          enum: ["loading", "available", "unavailable"],
        },
        assessment: { type: "string", minLength: 1, maxLength: 512 },
      },
    },
  },
  async (input, { site, signal }) =>
    (await site.execute(
      FLIGHTS_PRICE_INSIGHTS,
      input,
      signal,
    )) as unknown as PriceInsightsResult,
);

export const googleFlightsBrowserPack = mcp.build({
  fixtures: [
    {
      id: "page-adapter-required-search",
      tool: FLIGHTS_SEARCH,
      input: {
        origin: "LHR",
        destination: "CDG",
        outboundDate: "2026-10-27",
        returnDate: "2026-11-03",
      },
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-adapter-required-current-search",
      tool: FLIGHTS_CURRENT_SEARCH,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-adapter-required-results",
      tool: FLIGHTS_RESULTS,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
    {
      id: "page-adapter-required-price-insights",
      tool: FLIGHTS_PRICE_INSIGHTS,
      input: {},
      expect: { kind: "error", code: "TOOL_NOT_FOUND" },
    },
  ],
  create: (document, services) =>
    createGoogleFlightsPageAdapter(
      createGoogleFlightsDocumentSource(
        document,
        createGrantedSearchNavigation(services.navigate),
      ),
    ),
  async discover({ site, signal }) {
    return (await site.capabilities(signal)).map(
      (capability) => capability.name,
    );
  },
  subscribe: (site, listener) => site.subscribe(listener),
});

export const googleFlightsPack = googleFlightsBrowserPack.definition;
