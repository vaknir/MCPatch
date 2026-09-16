import type { SessionScheduler } from "./native-session-model.js";

/**
 * Minimum time between two capability snapshots published by one document.
 * A page drives snapshots by firing `toolchange`, so without a floor it can
 * make the bridge recompile every schema as fast as it can dispatch events.
 */
export const MIN_SNAPSHOT_INTERVAL_MS = 250;

/**
 * Coalesces capability publications for one document.
 *
 * The first request in an idle window runs immediately, so an honest page
 * still publishes without delay. Every further request inside that window
 * collapses into one trailing run at the boundary, so a flood of any size
 * costs at most one extra publication per interval. The newest request wins,
 * because each one reads the adapter's current capabilities when it runs.
 */
export class SnapshotGate {
  readonly #scheduler: SessionScheduler;
  readonly #intervalMs: number;
  #lastRunMs: number | undefined;
  #pending: (() => void) | undefined;
  #timer: unknown;

  constructor(
    scheduler: SessionScheduler,
    intervalMs: number = MIN_SNAPSHOT_INTERVAL_MS,
  ) {
    this.#scheduler = scheduler;
    this.#intervalMs = intervalMs;
  }

  /** Run now, or once the current window closes. */
  request(run: () => void): void {
    const nowMs = this.#scheduler.now().getTime();
    const earliestMs = this.#earliestRunMs(nowMs);
    if (nowMs >= earliestMs) {
      this.#run(nowMs, run);
      return;
    }
    this.#pending = run;
    this.#timer ??= this.#scheduler.schedule(
      () => this.#flush(),
      earliestMs - nowMs,
    );
  }

  /** Drop any pending run, for a document that is closing or has failed. */
  cancel(): void {
    if (this.#timer !== undefined) this.#scheduler.cancel(this.#timer);
    this.#timer = undefined;
    this.#pending = undefined;
  }

  #earliestRunMs(nowMs: number): number {
    return this.#lastRunMs === undefined
      ? nowMs
      : this.#lastRunMs + this.#intervalMs;
  }

  #flush(): void {
    const run = this.#pending;
    this.#timer = undefined;
    this.#pending = undefined;
    if (run !== undefined) this.#run(this.#scheduler.now().getTime(), run);
  }

  #run(nowMs: number, run: () => void): void {
    this.#lastRunMs = nowMs;
    run();
  }
}
