export interface GoogleFlightsChangeScheduler {
  schedule(callback: () => void, delayMs: number): unknown;
  cancel(handle: unknown): void;
}

export interface CoalescedChangeSubscriptionOptions {
  readonly observe: (onMutation: () => void) => () => void;
  readonly readSignature: () => string;
  readonly listener: () => void;
  readonly scheduler: GoogleFlightsChangeScheduler;
}

const COALESCE_DELAY_MS = 250;

/** Coalesces noisy DOM mutations and notifies only after semantic state changes. */
export function createCoalescedChangeSubscription(
  options: CoalescedChangeSubscriptionOptions,
): () => void {
  let active = true;
  let scheduled = false;
  let pending: unknown;
  let signature = options.readSignature();
  const disconnect = options.observe(() => {
    if (!active || scheduled) return;
    scheduled = true;
    pending = options.scheduler.schedule(() => {
      scheduled = false;
      pending = undefined;
      if (!active) return;
      const next = options.readSignature();
      if (next === signature) return;
      signature = next;
      options.listener();
    }, COALESCE_DELAY_MS);
  });
  return () => {
    if (!active) return;
    active = false;
    if (scheduled) options.scheduler.cancel(pending);
    scheduled = false;
    pending = undefined;
    disconnect();
  };
}
