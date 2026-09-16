import { describe, expect, it, vi } from "vitest";

import {
  encodePageToWorkerMessage,
  PAGE_PROTOCOL_VERSION,
  parseWorkerToPageFrame,
  type PageBinding,
  type PageCapability,
  type PageHelloAck,
  type PageToolCall,
  type WorkerToPageMessage,
} from "../src/page-channel.js";
import {
  MCPATCH_PAGE_PORT_NAME,
  type PageAuthorization,
  type PageMessageSender,
} from "../src/page-context-model.js";
import { PageContextOwner } from "../src/page-context-owner.js";
import { FakeScheduler } from "./support/native-session.js";
import {
  FakePagePort,
  FakePageServiceRuntime,
  TEST_SENDER,
} from "./support/page-context.js";

const PACK_TOOL = "flights.current_search";
const NATIVE_TOOL = "native.current_search";
const PACK_CAPABILITY: PageCapability = {
  source: "pack",
  name: PACK_TOOL,
};
const NATIVE_CAPABILITY: PageCapability = {
  source: "native_webmcp",
  name: NATIVE_TOOL,
  description: "Read the current search.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: {
    readOnlyHint: true,
    consequentialHint: false,
    untrustedContentHint: true,
  },
};

describe("page context owner", () => {
  it.each([
    ["wrong extension", { id: "another-extension" }],
    ["subframe", { frameId: 1 }],
    ["prerender", { documentLifecycle: "prerender" }],
    ["missing document", { documentId: undefined }],
    [
      "insecure URL",
      { origin: "http://example.com", url: "http://example.com/" },
    ],
    ["crossed origin", { origin: "https://attacker.example" }],
  ])("rejects a %s sender before handshake", (_name, overrides) => {
    const { runtime } = setup();
    const port = new FakePagePort(
      MCPATCH_PAGE_PORT_NAME,
      sender(overrides as Partial<PageMessageSender>),
    );

    runtime.connect(port);

    expect(port.disconnected).toBe(true);
    expect(port.posted).toEqual([]);
  });

  it("ignores unrelated ports and denies origins without authority", () => {
    const { runtime } = setup({ authorized: false });
    const unrelated = new FakePagePort("another.port");
    const denied = new FakePagePort(MCPATCH_PAGE_PORT_NAME);

    runtime.connect(unrelated);
    runtime.connect(denied);

    expect(unrelated.disconnected).toBe(false);
    expect(denied.disconnected).toBe(true);
  });

  it("bounds negotiating ports and rejects a duplicate document owner", () => {
    const negotiating = setup();
    const ports = Array.from(
      { length: 5 },
      () => new FakePagePort(MCPATCH_PAGE_PORT_NAME),
    );
    for (const port of ports) negotiating.runtime.connect(port);
    expect(ports.slice(0, 4).every((port) => !port.disconnected)).toBe(true);
    expect(ports[4]?.disconnected).toBe(true);

    const state = setup();
    const first = connectAndEstablish(state, TEST_SENDER);
    const duplicate = connectAndEstablish(state, TEST_SENDER);
    expect(first.disconnected).toBe(false);
    expect(duplicate.disconnected).toBe(true);
    expect(state.owner.activeContexts).toHaveLength(1);
  });

  it("binds an authorized top-level document only after a valid hello", () => {
    const onSnapshot = vi.fn();
    const { owner, port } = establish({ onSnapshot });
    const ack = posted<PageHelloAck>(port, 0);

    expect(ack).toMatchObject({
      type: "page_hello_ack",
      channelId: "channel.test",
      contextId: "page.7",
      contextRevision: 1,
      tabId: 7,
      documentId: "document-1",
      origin: "https://example.com",
      authorizedPackTools: [PACK_TOOL],
    });
    expect(owner.activeContexts).toHaveLength(1);
    expect(owner.activeContexts[0]?.snapshotRevision).toBe(0);

    publish(port, ack, 1, [PACK_CAPABILITY, NATIVE_CAPABILITY]);

    expect(owner.activeContexts[0]?.capabilities).toEqual(
      new Set([PACK_TOOL, NATIVE_TOOL]),
    );
    expect(onSnapshot).toHaveBeenCalledOnce();
  });

  it("bounds negotiation and rejects malformed or stale snapshots", () => {
    const handshake = setup();
    const silent = new FakePagePort(MCPATCH_PAGE_PORT_NAME);
    handshake.runtime.connect(silent);
    handshake.scheduler.advanceBy(49);
    expect(silent.disconnected).toBe(false);
    handshake.scheduler.advanceBy(1);
    expect(silent.disconnected).toBe(true);

    const malformed = establish();
    malformed.port.emitMessage("not-json");
    expect(malformed.port.disconnected).toBe(true);

    const stale = establish();
    const binding = posted(stale.port, 0);
    publish(stale.port, binding, 1, [PACK_CAPABILITY]);
    publish(stale.port, binding, 1, [PACK_CAPABILITY]);
    expect(stale.port.disconnected).toBe(true);
  });

  it("atomically replaces a tab owner when its document changes", () => {
    const onClosed = vi.fn();
    const state = setup({ onClosed });
    const first = connectAndEstablish(state, TEST_SENDER);
    const firstBinding = posted<PageHelloAck>(first, 0);
    publish(first, firstBinding, 1, [PACK_CAPABILITY]);

    const second = connectAndEstablish(
      state,
      sender({ documentId: "document-2", url: "https://example.com/new" }),
    );
    const secondBinding = posted<PageHelloAck>(second, 0);

    expect(first.disconnected).toBe(true);
    expect(secondBinding.contextId).toBe(firstBinding.contextId);
    expect(secondBinding.contextRevision).toBe(2);
    expect(state.owner.activeContexts).toHaveLength(1);
    expect(onClosed).toHaveBeenCalledWith("page.7", "navigation");
  });

  it("routes one exact invocation and resolves only its bound reply", async () => {
    const { owner, port } = establish();
    const binding = posted<PageHelloAck>(port, 0);
    publish(port, binding, 1, [PACK_CAPABILITY]);
    const controller = new AbortController();

    const result = owner.invoke(
      binding.contextId,
      PACK_TOOL,
      { cabin: "economy" },
      controller.signal,
    );
    const call = posted<PageToolCall>(port, 1);
    expect(call).toMatchObject({
      type: "page_tool_call",
      tool: PACK_TOOL,
      args: { cabin: "economy" },
    });
    port.emitMessage(
      encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_tool_result",
        ...bindingFields(binding),
        requestId: call.requestId,
        tool: PACK_TOOL,
        result: { query: "TLV-LHR" },
      }),
    );

    await expect(result).resolves.toEqual({
      result: { query: "TLV-LHR" },
    });
  });

  it("revokes crossed replies, expired authority, aborts, and timeouts", async () => {
    const crossed = establish();
    const crossedBinding = posted<PageHelloAck>(crossed.port, 0);
    publish(crossed.port, crossedBinding, 1, [PACK_CAPABILITY]);
    const crossedResult = crossed.owner.invoke(
      crossedBinding.contextId,
      PACK_TOOL,
      {},
      new AbortController().signal,
    );
    const crossedCall = posted<PageToolCall>(crossed.port, 1);
    crossed.port.emitMessage(
      encodePageToWorkerMessage({
        pageProtocolVersion: PAGE_PROTOCOL_VERSION,
        type: "page_tool_result",
        ...bindingFields(crossedBinding),
        requestId: crossedCall.requestId,
        tool: "flights.results",
        result: {},
      }),
    );
    await expect(crossedResult).rejects.toMatchObject({ code: "CANCELLED" });
    expect(crossed.port.disconnected).toBe(true);

    const revoked = establish();
    const revokedBinding = posted<PageHelloAck>(revoked.port, 0);
    publish(revoked.port, revokedBinding, 1, [PACK_CAPABILITY]);
    revoked.authorizedTools.clear();
    await expect(
      revoked.owner.invoke(
        revokedBinding.contextId,
        PACK_TOOL,
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "TOOL_UNAVAILABLE" });
    expect(revoked.port.disconnected).toBe(true);

    const aborted = establish();
    const abortedBinding = posted<PageHelloAck>(aborted.port, 0);
    publish(aborted.port, abortedBinding, 1, [PACK_CAPABILITY]);
    const abort = new AbortController();
    const abortedResult = aborted.owner.invoke(
      abortedBinding.contextId,
      PACK_TOOL,
      {},
      abort.signal,
    );
    abort.abort();
    await expect(abortedResult).rejects.toMatchObject({ code: "CANCELLED" });
    expect(posted<WorkerToPageMessage>(aborted.port, 2).type).toBe(
      "page_cancel",
    );

    const timed = establish();
    const timedBinding = posted<PageHelloAck>(timed.port, 0);
    publish(timed.port, timedBinding, 1, [PACK_CAPABILITY]);
    const timedResult = timed.owner.invoke(
      timedBinding.contextId,
      PACK_TOOL,
      {},
      new AbortController().signal,
    );
    timed.scheduler.advanceBy(25);
    await expect(timedResult).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(posted<WorkerToPageMessage>(timed.port, 2).type).toBe("page_cancel");
  });

  it("revokes all state by exact origin", () => {
    const onClosed = vi.fn();
    const state = establish({ onClosed });
    const binding = posted<PageHelloAck>(state.port, 0);
    publish(state.port, binding, 1, [PACK_CAPABILITY]);

    state.owner.revokeOrigin("https://another.example");
    expect(state.port.disconnected).toBe(false);
    state.owner.revokeOrigin("https://example.com");

    expect(state.port.disconnected).toBe(true);
    expect(state.owner.activeContexts).toEqual([]);
    expect(onClosed).toHaveBeenCalledWith("page.7", "pack_disabled");
  });
});

interface SetupOptions {
  readonly authorized?: boolean;
  readonly onClosed?: (
    contextId: string,
    reason: "disconnected" | "navigation" | "pack_disabled",
  ) => void;
  readonly onSnapshot?: (snapshot: unknown) => void;
}

function setup(options: SetupOptions = {}) {
  const runtime = new FakePageServiceRuntime();
  const scheduler = new FakeScheduler();
  const authorizedTools = new Set([PACK_TOOL]);
  const owner = new PageContextOwner(runtime, {
    authority: {
      authorize(): PageAuthorization | undefined {
        return options.authorized === false
          ? undefined
          : { packTools: new Set(authorizedTools) };
      },
    },
    callTimeoutMs: 25,
    handshakeTimeoutMs: 50,
    ...(options.onClosed === undefined ? {} : { onClosed: options.onClosed }),
    ...(options.onSnapshot === undefined
      ? {}
      : { onSnapshot: options.onSnapshot }),
    randomId: () => "channel.test",
    scheduler,
  });
  return { authorizedTools, owner, runtime, scheduler };
}

function establish(options: SetupOptions = {}) {
  const state = setup(options);
  const port = connectAndEstablish(state, TEST_SENDER);
  return { ...state, port };
}

function connectAndEstablish(
  state: ReturnType<typeof setup>,
  pageSender: PageMessageSender,
): FakePagePort {
  const port = new FakePagePort(MCPATCH_PAGE_PORT_NAME, pageSender);
  state.runtime.connect(port);
  port.emitMessage(
    encodePageToWorkerMessage({
      pageProtocolVersion: PAGE_PROTOCOL_VERSION,
      type: "page_hello",
      supportedPageProtocolVersions: [PAGE_PROTOCOL_VERSION],
      implementation: { name: "test-content", version: "0.1.0" },
    }),
  );
  return port;
}

function publish(
  port: FakePagePort,
  binding: PageBinding,
  snapshotRevision: number,
  capabilities: readonly PageCapability[],
): void {
  port.emitMessage(
    encodePageToWorkerMessage({
      pageProtocolVersion: PAGE_PROTOCOL_VERSION,
      type: "page_capability_snapshot",
      ...bindingFields(binding),
      snapshotRevision,
      capabilities,
    }),
  );
}

function posted<Message extends WorkerToPageMessage>(
  port: FakePagePort,
  index: number,
): Message {
  return parseWorkerToPageFrame(port.posted[index]) as Message;
}

function sender(overrides: Partial<PageMessageSender>): PageMessageSender {
  return { ...TEST_SENDER, ...overrides };
}

function bindingFields(binding: PageBinding): PageBinding {
  return {
    channelId: binding.channelId,
    contextId: binding.contextId,
    contextRevision: binding.contextRevision,
    tabId: binding.tabId,
    documentId: binding.documentId,
    origin: binding.origin,
  };
}
