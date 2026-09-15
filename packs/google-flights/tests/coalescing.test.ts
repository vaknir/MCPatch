import { describe, expect, it, vi } from "vitest";

import {
  createCoalescedChangeSubscription,
  type GoogleFlightsChangeScheduler,
} from "../src/index.js";

describe("Google Flights mutation coalescing", () => {
  it("coalesces bursts, ignores unchanged signatures, and cancels cleanup", () => {
    vi.useFakeTimers();
    let mutation: (() => void) | undefined;
    let signature = "first";
    const disconnect = vi.fn();
    const listener = vi.fn();
    const scheduler: GoogleFlightsChangeScheduler = {
      schedule(callback, delayMs) {
        return setTimeout(callback, delayMs);
      },
      cancel(handle) {
        clearTimeout(handle as ReturnType<typeof setTimeout>);
      },
    };
    const cleanup = createCoalescedChangeSubscription({
      observe(next) {
        mutation = next;
        return disconnect;
      },
      readSignature() {
        return signature;
      },
      listener,
      scheduler,
    });

    mutation?.();
    mutation?.();
    vi.advanceTimersByTime(249);
    expect(listener).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(listener).not.toHaveBeenCalled();

    signature = "second";
    mutation?.();
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledOnce();

    signature = "third";
    mutation?.();
    cleanup();
    cleanup();
    vi.advanceTimersByTime(250);
    expect(listener).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
