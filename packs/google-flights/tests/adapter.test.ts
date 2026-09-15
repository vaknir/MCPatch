import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import {
  FLIGHTS_CURRENT_SEARCH,
  FLIGHTS_PRICE_INSIGHTS,
  FLIGHTS_RESULTS,
  FLIGHTS_SEARCH,
  GoogleFlightsAdapterError,
  createGoogleFlightsPageAdapter,
  type GoogleFlightsSemanticSnapshot,
  type GoogleFlightsSnapshotSource,
} from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/snapshots.json", import.meta.url), "utf8"),
) as Record<string, GoogleFlightsSemanticSnapshot>;

describe("Google Flights page adapter", () => {
  it("publishes search on both paths and read results only on the result path", async () => {
    const landing = createGoogleFlightsPageAdapter(source("landing"));
    await expect(landing.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: FLIGHTS_CURRENT_SEARCH },
      { source: "pack", name: FLIGHTS_SEARCH },
    ]);

    const ready = createGoogleFlightsPageAdapter(source("ready"));
    await expect(ready.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: FLIGHTS_CURRENT_SEARCH },
      { source: "pack", name: FLIGHTS_SEARCH },
      { source: "pack", name: FLIGHTS_RESULTS },
      { source: "pack", name: FLIGHTS_PRICE_INSIGHTS },
    ]);
  });

  it("executes one validated action and returns only a bounded acknowledgement", async () => {
    const snapshots = source("landing");
    const adapter = createGoogleFlightsPageAdapter(snapshots);
    const input = futureSearch();

    await expect(
      adapter.execute(FLIGHTS_SEARCH, input, signal()),
    ).resolves.toEqual({
      fingerprint: "google-flights-rendered-en-v1",
      state: "accepted",
    });
    expect(snapshots.search).toHaveBeenCalledWith(
      input,
      expect.any(AbortSignal),
    );
    await expect(adapter.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: FLIGHTS_CURRENT_SEARCH },
    ]);
  });

  it("rejects concurrent and repeated searches in the same document", async () => {
    let complete: (() => void) | undefined;
    const snapshots = source("landing");
    snapshots.search.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    const adapter = createGoogleFlightsPageAdapter(snapshots);
    const first = adapter.execute(FLIGHTS_SEARCH, futureSearch(), signal());
    await Promise.resolve();
    await Promise.resolve();

    await expectAdapterError(
      adapter.execute(FLIGHTS_SEARCH, futureSearch(), signal()),
      "EXECUTION_FAILED",
      "search_already_started",
    );
    complete?.();
    await expect(first).resolves.toMatchObject({ state: "accepted" });
    await expectAdapterError(
      adapter.execute(FLIGHTS_SEARCH, futureSearch(), signal()),
      "EXECUTION_FAILED",
      "search_already_started",
    );
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
    await expectAdapterError(
      adapter.execute(
        FLIGHTS_SEARCH,
        { ...futureSearch(), origin: "London" },
        signal(),
      ),
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

    const unsupportedOptions = structuredClone(fixture.landing);
    if (unsupportedOptions === undefined) throw new Error("fixture invariant");
    unsupportedOptions.controls.tripType = [{ visible: true, text: "One way" }];
    await expectAdapterError(
      createGoogleFlightsPageAdapter({
        ...memorySource(unsupportedOptions),
        async search() {},
      }).execute(FLIGHTS_SEARCH, futureSearch(), signal()),
      "EXECUTION_FAILED",
      "unsupported_search_options",
    );
  });

  it("omits the action when no reviewed search source is installed", async () => {
    const landing = fixture.landing;
    if (landing === undefined) throw new Error("fixture invariant");
    const adapter = createGoogleFlightsPageAdapter(memorySource(landing));

    await expect(adapter.capabilities(signal())).resolves.toEqual([
      { source: "pack", name: FLIGHTS_CURRENT_SEARCH },
    ]);
    await expectAdapterError(
      adapter.execute(FLIGHTS_SEARCH, futureSearch(), signal()),
      "TOOL_UNAVAILABLE",
      "tool_unavailable",
    );
  });

  it("passes through one source subscription and cleans it up exactly once", () => {
    const unsubscribe = vi.fn();
    let changed: (() => void) | undefined;
    const subscribe = vi.fn((sourceListener: () => void) => {
      changed = sourceListener;
      return unsubscribe;
    });
    const snapshots = { ...source("ready"), subscribe };
    const adapter = createGoogleFlightsPageAdapter(snapshots);
    const listener = vi.fn();
    const cleanup = adapter.subscribe(listener);

    expect(subscribe).toHaveBeenCalledWith(expect.any(Function));
    changed?.();
    expect(listener).toHaveBeenCalledOnce();
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
    search: vi.fn(async (): Promise<void> => undefined),
    subscribe: vi.fn(() => () => undefined),
  } satisfies GoogleFlightsSnapshotSource;
}

function futureSearch() {
  return {
    origin: "LHR",
    destination: "CDG",
    outboundDate: isoDateFromNow(45),
    returnDate: isoDateFromNow(52),
  };
}

function isoDateFromNow(days: number): string {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
