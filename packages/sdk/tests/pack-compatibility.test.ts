import { describe, expect, it } from "vitest";

import {
  packSupportsBridgeProtocol,
  packSupportsRuntime,
} from "../src/index.js";
import { pack } from "./support/pack.js";

const manifest = pack({ id: "compatibility", tools: ["acme.demo.read"] });

describe("pack environment compatibility", () => {
  it("uses a closed-open stable runtime interval", () => {
    expect(packSupportsRuntime(manifest, "0.1.0")).toBe(true);
    expect(packSupportsRuntime(manifest, "0.1.999")).toBe(true);
    expect(packSupportsRuntime(manifest, "0.2.0")).toBe(false);
    expect(packSupportsRuntime(manifest, "0.1")).toBe(false);
  });

  it("uses a closed integer bridge protocol interval", () => {
    expect(packSupportsBridgeProtocol(manifest, 1)).toBe(true);
    expect(packSupportsBridgeProtocol(manifest, 2)).toBe(false);
    expect(packSupportsBridgeProtocol(manifest, 1.5)).toBe(false);
  });
});
