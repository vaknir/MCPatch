import { describe, expect, it, vi } from "vitest";

import {
  MIN_SNAPSHOT_INTERVAL_MS,
  SnapshotGate,
} from "../src/page-snapshot-gate.js";
import { FakeScheduler } from "./support/native-session.js";

describe("page snapshot gate", () => {
  it("runs the first request in an idle window immediately", () => {
    const scheduler = new FakeScheduler();
    const gate = new SnapshotGate(scheduler);
    const run = vi.fn();

    gate.request(run);

    expect(run).toHaveBeenCalledOnce();
  });

  it("collapses a flood inside one window into a single trailing run", () => {
    const scheduler = new FakeScheduler();
    const gate = new SnapshotGate(scheduler);
    const run = vi.fn();

    for (let index = 0; index < 1_000; index += 1) gate.request(run);
    // Only the leading run has happened; the rest are still pending.
    expect(run).toHaveBeenCalledOnce();

    scheduler.advanceBy(MIN_SNAPSHOT_INTERVAL_MS);
    expect(run).toHaveBeenCalledTimes(2);

    // The window drained, so nothing further fires on its own.
    scheduler.advanceBy(MIN_SNAPSHOT_INTERVAL_MS * 10);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("runs the newest request when several coalesce", () => {
    const scheduler = new FakeScheduler();
    const gate = new SnapshotGate(scheduler);
    const first = vi.fn();
    const stale = vi.fn();
    const newest = vi.fn();

    gate.request(first);
    gate.request(stale);
    gate.request(newest);
    scheduler.advanceBy(MIN_SNAPSHOT_INTERVAL_MS);

    expect(first).toHaveBeenCalledOnce();
    expect(stale).not.toHaveBeenCalled();
    expect(newest).toHaveBeenCalledOnce();
  });

  it("runs immediately again once a full interval has passed", () => {
    const scheduler = new FakeScheduler();
    const gate = new SnapshotGate(scheduler);
    const run = vi.fn();

    gate.request(run);
    scheduler.advanceBy(MIN_SNAPSHOT_INTERVAL_MS);
    gate.request(run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it("drops a pending run when cancelled", () => {
    const scheduler = new FakeScheduler();
    const gate = new SnapshotGate(scheduler);
    const run = vi.fn();

    gate.request(run);
    gate.request(run);
    gate.cancel();
    scheduler.advanceBy(MIN_SNAPSHOT_INTERVAL_MS * 4);

    expect(run).toHaveBeenCalledOnce();
  });
});
