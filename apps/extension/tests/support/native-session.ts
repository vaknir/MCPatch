import { parseMessage, type Message } from "@mcpatch/protocol";

import type { ChromeEvent, InstalledDetails } from "../../src/lifecycle.js";
import type {
  ChromeNativeRuntimeApi,
  NativePort,
  SessionScheduler,
} from "../../src/native-session.js";

const BASE_TIME = Date.UTC(2026, 8, 15, 0, 0, 0);

export const TEST_OPTIONS = {
  handshakeTimeoutMs: 50,
  heartbeatIntervalMs: 100,
  retryDelaysMs: [10, 20, 40],
} as const;

export function parsePosted(port: FakePort, index: number): Message {
  return parseMessage(port.posted[index]);
}

export class FakeRuntime implements ChromeNativeRuntimeApi {
  readonly applications: string[] = [];
  readonly onInstalled = new FakeChromeEvent<[InstalledDetails]>();
  readonly onStartup = new FakeChromeEvent<[]>();
  readonly ports: FakePort[] = [];

  get latestPort(): FakePort {
    const port = this.ports.at(-1);
    if (port === undefined) throw new Error("no fake native port was opened");
    return port;
  }

  connectNative(application: string): NativePort {
    this.applications.push(application);
    const port = new FakePort();
    this.ports.push(port);
    return port;
  }
}

export class FakePort implements NativePort {
  readonly onDisconnect = new FakeChromeEvent<[]>();
  readonly onMessage = new FakeChromeEvent<[unknown]>();
  readonly posted: unknown[] = [];
  disconnected = false;

  disconnect(): void {
    this.disconnected = true;
  }

  postMessage(message: unknown): void {
    if (this.disconnected) throw new Error("port is disconnected");
    this.posted.push(structuredClone(message));
  }

  emitDisconnect(): void {
    this.disconnected = true;
    this.onDisconnect.emit();
  }

  emitMessage(message: unknown): void {
    this.onMessage.emit(structuredClone(message));
  }
}

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

export class FakeScheduler implements SessionScheduler {
  readonly #tasks = new Map<
    number,
    { readonly callback: () => void; readonly dueAt: number }
  >();
  #nextId = 0;
  #nowMs = 0;

  cancel(handle: unknown): void {
    if (typeof handle === "number") this.#tasks.delete(handle);
  }

  now(): Date {
    return new Date(BASE_TIME + this.#nowMs);
  }

  schedule(callback: () => void, delayMs: number): unknown {
    const id = ++this.#nextId;
    this.#tasks.set(id, { callback, dueAt: this.#nowMs + delayMs });
    return id;
  }

  advanceBy(durationMs: number): void {
    const target = this.#nowMs + durationMs;
    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort(([firstId, first], [secondId, second]) =>
          first.dueAt === second.dueAt
            ? firstId - secondId
            : first.dueAt - second.dueAt,
        )[0];
      if (next === undefined) break;
      const [id, task] = next;
      this.#tasks.delete(id);
      this.#nowMs = task.dueAt;
      task.callback();
    }
    this.#nowMs = target;
  }
}
