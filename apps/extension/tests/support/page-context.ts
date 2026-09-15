import type { ChromeEvent } from "../../src/lifecycle.js";
import type {
  ChromePageClientRuntimeApi,
  PageLifecycleApi,
} from "../../src/page-content-model.js";
import type {
  ChromePageServiceRuntimeApi,
  PageMessageSender,
  PagePort,
} from "../../src/page-context-model.js";
import { FakeChromeEvent } from "./native-session.js";

export const TEST_SENDER: PageMessageSender = Object.freeze({
  id: "test-extension-id",
  documentId: "document-1",
  documentLifecycle: "active",
  frameId: 0,
  origin: "https://example.com",
  tab: { id: 7 },
  url: "https://example.com/flights?from=TLV",
});

export class FakePagePort implements PagePort {
  readonly onDisconnect: ChromeEvent<[]> & FakeChromeEvent<[]> =
    new FakeChromeEvent<[]>();
  readonly onMessage: ChromeEvent<[unknown]> & FakeChromeEvent<[unknown]> =
    new FakeChromeEvent<[unknown]>();
  readonly posted: unknown[] = [];
  readonly sender?: PageMessageSender;
  disconnected = false;

  constructor(
    readonly name: string,
    sender: PageMessageSender | undefined = TEST_SENDER,
  ) {
    if (sender !== undefined) this.sender = sender;
  }

  disconnect(): void {
    this.disconnected = true;
  }

  postMessage(message: unknown): void {
    if (this.disconnected) throw new Error("page port is disconnected");
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

export class FakePageServiceRuntime implements ChromePageServiceRuntimeApi {
  readonly id = "test-extension-id";
  readonly onConnect = new FakeChromeEvent<[PagePort]>();

  connect(port: FakePagePort): void {
    this.onConnect.emit(port);
  }
}

export class FakePageClientRuntime implements ChromePageClientRuntimeApi {
  readonly ports: FakePagePort[] = [];

  get latestPort(): FakePagePort {
    const port = this.ports.at(-1);
    if (port === undefined) throw new Error("no page port was opened");
    return port;
  }

  connect({ name }: { readonly name: string }): PagePort {
    const port = new FakePagePort(name, undefined);
    this.ports.push(port);
    return port;
  }
}

export class FakePageLifecycle implements PageLifecycleApi {
  readonly listeners: Array<() => void> = [];

  addEventListener(type: "pagehide", listener: () => void): void {
    if (type === "pagehide") this.listeners.push(listener);
  }

  pagehide(): void {
    for (const listener of this.listeners.splice(0)) listener();
  }
}
