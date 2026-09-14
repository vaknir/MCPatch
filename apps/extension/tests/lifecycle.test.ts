import { describe, expect, it, vi } from "vitest";

import {
  registerLifecycleListeners,
  type ChromeEvent,
  type InstalledDetails,
  type LifecycleWake,
} from "../src/lifecycle.js";

describe("extension lifecycle", () => {
  it("registers listeners synchronously and translates lifecycle events", () => {
    const installed = new FakeChromeEvent<[InstalledDetails]>();
    const startup = new FakeChromeEvent<[]>();
    const wake = vi.fn<(event: LifecycleWake) => void>();

    registerLifecycleListeners(
      { onInstalled: installed, onStartup: startup },
      wake,
    );

    expect(installed.listenerCount).toBe(1);
    expect(startup.listenerCount).toBe(1);

    installed.emit({ reason: "install" });
    startup.emit();
    expect(wake.mock.calls).toEqual([
      [{ type: "installed", reason: "install" }],
      [{ type: "startup" }],
    ]);
  });
});

class FakeChromeEvent<
  Arguments extends unknown[],
> implements ChromeEvent<Arguments> {
  readonly #listeners: Array<(...arguments_: Arguments) => void> = [];

  get listenerCount(): number {
    return this.#listeners.length;
  }

  addListener(listener: (...arguments_: Arguments) => void): void {
    this.#listeners.push(listener);
  }

  emit(...arguments_: Arguments): void {
    for (const listener of this.#listeners) listener(...arguments_);
  }
}
