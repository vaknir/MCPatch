import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_PRICE_INSIGHTS,
  FLIGHTS_RESULTS,
  GoogleFlightsAdapterError,
  createGoogleFlightsPageAdapter,
  type GoogleFlightsSemanticSnapshot,
  type GoogleFlightsSnapshotSource,
} from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/snapshots.json", import.meta.url), "utf8"),
) as Record<string, GoogleFlightsSemanticSnapshot>;

describe("Google Flights page adapter", () => {
  it("publishes one landing tool and three result-page tools", async () => {
    const landing = createGoogleFlightsPageAdapter(source("landing"));
    await expect(landing.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: FLIGHTS_CURRENT_SEARCH },
    ]);

    const ready = createGoogleFlightsPageAdapter(source("ready"));
    await expect(ready.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: FLIGHTS_CURRENT_SEARCH },
      { source: "pack", name: FLIGHTS_RESULTS },
      { source: "pack", name: FLIGHTS_PRICE_INSIGHTS },
    ]);
  });

  it("executes only declared empty-input read tools against a fresh snapshot", async () => {
    const snapshots = source("ready");
    const adapter = createGoogleFlightsPageAdapter(snapshots);
    await expect(
      adapter.execute(FLIGHTS_CURRENT_SEARCH, {}, signal()),
    ).resolves.toMatchObject({ origin: "Alder Bay" });
    await expect(
      adapter.execute(FLIGHTS_RESULTS, {}, signal()),
    ).resolves.toMatchObject({ state: "ready", reportedCount: 24 });
    await expect(
      adapter.execute(FLIGHTS_PRICE_INSIGHTS, {}, signal()),
    ).resolves.toMatchObject({ state: "available" });
    expect(snapshots.read).toHaveBeenCalledTimes(3);
  });

  it("rejects undeclared tools, non-empty arguments, incompatible pages, and cancellation", async () => {
    const adapter = createGoogleFlightsPageAdapter(source("ready"));
    await expectAdapterError(
      adapter.execute("flights.book", {}, signal()),
      "TOOL_UNAVAILABLE",
    );
    await expectAdapterError(
      adapter.execute(FLIGHTS_RESULTS, { page: 2 }, signal()),
      "EXECUTION_FAILED",
      "invalid_arguments",
    );

    const incompatible = structuredClone(fixture.ready);
    if (incompatible === undefined) throw new Error("fixture invariant");
    incompatible.language = "de-DE";
    await expectAdapterError(
      createGoogleFlightsPageAdapter(memorySource(incompatible)).capabilities(
        signal(),
      ),
      "EXECUTION_FAILED",
      "unsupported_locale",
    );

    const controller = new AbortController();
    controller.abort();
    await expectAdapterError(
      adapter.execute(FLIGHTS_RESULTS, {}, controller.signal),
      "CANCELLED",
      "cancelled",
    );
  });

  it("passes through one source subscription and cleans it up exactly once", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn((sourceListener: () => void) => {
      void sourceListener;
      return unsubscribe;
    });
    const snapshots = { ...source("ready"), subscribe };
    const adapter = createGoogleFlightsPageAdapter(snapshots);
    const listener = vi.fn();
    const cleanup = adapter.subscribe(listener);

    expect(subscribe).toHaveBeenCalledWith(listener);
    cleanup();
    cleanup();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

function source(name: string) {
  const snapshot = fixture[name];
  if (snapshot === undefined) throw new Error(`missing fixture ${name}`);
  return {
    read: vi.fn(async () => structuredClone(snapshot)),
    subscribe: vi.fn(() => () => undefined),
  } satisfies GoogleFlightsSnapshotSource;
}

function memorySource(
  snapshot: GoogleFlightsSemanticSnapshot,
): GoogleFlightsSnapshotSource {
  return {
    async read() {
      return structuredClone(snapshot);
    },
  };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function expectAdapterError(
  promise: Promise<unknown>,
  code: GoogleFlightsAdapterError["code"],
  reason?: GoogleFlightsAdapterError["reason"],
): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(GoogleFlightsAdapterError);
  await expect(promise).rejects.toMatchObject({
    code,
    ...(reason === undefined ? {} : { reason }),
  });
}
