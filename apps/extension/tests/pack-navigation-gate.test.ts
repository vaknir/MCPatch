import { googleFlightsPack } from "@mcpatch/google-flights-pack";
import { describe, expect, it, vi } from "vitest";

import { PackNavigationGate } from "../src/pack-navigation-gate.js";

const SEARCH_URL = "https://www.google.com/travel/flights/search?tfs=abc";

function gate(): {
  gate: PackNavigationGate;
  assign: ReturnType<typeof vi.fn>;
  run: () => void;
} {
  const assign = vi.fn();
  const deferred: (() => void)[] = [];
  return {
    gate: new PackNavigationGate(
      googleFlightsPack.manifest,
      { assign },
      (task) => deferred.push(task),
    ),
    assign,
    run: () => {
      for (const task of deferred.splice(0)) task();
    },
  };
}

describe("pack navigation gate", () => {
  it("refuses navigation when no approved action is running", () => {
    const { gate: g, assign } = gate();
    expect(() => g.navigate(SEARCH_URL)).toThrow(/approved MCPatch action/);
    expect(assign).not.toHaveBeenCalled();
  });

  it("navigates once while armed and refuses a second attempt", () => {
    const { gate: g, assign, run } = gate();
    g.arm();
    g.navigate(SEARCH_URL);
    // Deferred until the call returns, so the tool result is sent first.
    expect(assign).not.toHaveBeenCalled();
    run();
    expect(assign).toHaveBeenCalledWith(SEARCH_URL);
    expect(() => g.navigate(SEARCH_URL)).toThrow(/approved MCPatch action/);
    expect(assign).toHaveBeenCalledOnce();
  });

  it("refuses a target the pack does not match, even while armed", () => {
    const { gate: g, assign } = gate();
    for (const target of [
      "https://www.google.com/search?q=x",
      "https://attacker.example/travel/flights",
      "http://www.google.com/travel/flights",
      "not a url",
    ]) {
      g.arm();
      expect(() => g.navigate(target)).toThrow(/outside the pack's matches/);
    }
    expect(assign).not.toHaveBeenCalled();
  });

  it("stops navigating once disarmed", () => {
    const { gate: g, assign, run } = gate();
    g.arm();
    g.disarm();
    expect(() => g.navigate(SEARCH_URL)).toThrow(/approved MCPatch action/);
    run();
    expect(assign).not.toHaveBeenCalled();
  });

  it("still performs a navigation authorized before the call ended", () => {
    const { gate: g, assign, run } = gate();
    g.arm();
    g.navigate(SEARCH_URL);
    // The adapter disarms when the call returns; the authorized navigation
    // was already decided and still happens.
    g.disarm();
    run();
    expect(assign).toHaveBeenCalledWith(SEARCH_URL);
  });
});
