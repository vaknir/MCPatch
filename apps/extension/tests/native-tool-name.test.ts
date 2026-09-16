import { describe, expect, it } from "vitest";

import { nativeToolName } from "../src/native-tool-name.js";

describe("native tool naming", () => {
  it("qualifies a page tool with the reserved namespace and its origin", () => {
    expect(
      nativeToolName("https://www.google.com", "flights.price_insights"),
    ).toBe("native.www_google_com.flights.price_insights");
  });

  it("folds hyphens and ports into segment-safe separators", () => {
    expect(
      nativeToolName("https://symbol-search.tradingview.com", "quote"),
    ).toBe("native.symbol_search_tradingview_com.quote");
    expect(nativeToolName("https://example.com:8443", "read")).toBe(
      "native.example_com_8443.read",
    );
  });

  it("cannot be driven out of the namespace by a hostile page name", () => {
    // Whatever the page calls its tool, the published name still begins with
    // the reserved segment, so it cannot land in a pack's space.
    for (const pageName of ["flights.search", "native.other.tool"]) {
      expect(nativeToolName("https://shop.example", pageName)).toMatch(
        /^native\.shop_example\./u,
      );
    }
  });

  it("drops a tool whose name could not be a valid tool name", () => {
    for (const pageName of [
      "",
      "Flights.Search",
      "flights search",
      "1flights.x",
      "flights..x",
    ]) {
      expect(nativeToolName("https://shop.example", pageName)).toBeUndefined();
    }
  });

  it("drops a tool whose origin is not a canonical https origin", () => {
    for (const origin of [
      "http://shop.example",
      "https://shop.example/path",
      "not a url",
    ]) {
      expect(nativeToolName(origin, "read")).toBeUndefined();
    }
  });

  it("drops a name that would exceed the protocol bound", () => {
    expect(
      nativeToolName("https://shop.example", `a.${"b".repeat(200)}`),
    ).toBeUndefined();
  });
});
