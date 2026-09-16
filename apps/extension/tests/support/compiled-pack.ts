import {
  DEMO_CONTEXT_ID,
  DEMO_ORIGIN,
  DEMO_TOOL_NAME,
  DEMO_URL,
  demoPack,
} from "@mcpatch/example-packs";
import {
  definePack,
  defineTool,
  type JsonObject,
  type PackToolHandler,
} from "@mcpatch/sdk/runtime";
import {
  parseMessage,
  PROTOCOL_VERSION,
  type Message,
  type ToolCall,
} from "@mcpatch/protocol";

import { CompiledPackRuntime } from "../../src/compiled-pack-runtime.js";
import type { CompiledPackSubject } from "../../src/compiled-pack-validation.js";
import { startExtensionRuntime } from "../../src/runtime.js";
import { FakeRuntime, FakeScheduler, TEST_OPTIONS } from "./native-session.js";

export type TestHandler = PackToolHandler<
  JsonObject,
  { readonly source: string }
>;

export function packRuntime(
  definitions: readonly CompiledPackSubject[] = [demoPack],
) {
  const sent: Message[] = [];
  const runtime = new CompiledPackRuntime(
    (message) => {
      sent.push(parseMessage(message));
      return true;
    },
    definitions,
    {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: 2,
      allowedPermissions: ["READ", "ACTION"],
    },
  );
  return { runtime, sent };
}

export function readyPackRuntime(
  definitions: readonly CompiledPackSubject[] = [demoPack],
) {
  const state = packRuntime(definitions);
  state.runtime.activateContext({
    contextId: DEMO_CONTEXT_ID,
    url: DEMO_URL,
    native: [],
  });
  return state;
}

export function testPack(execute: TestHandler, id = "builtin-demo") {
  const tool = defineTool({
    name: DEMO_TOOL_NAME,
    description: "Return the selected source",
    risk: "read",
    permissions: ["READ"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
      maxProperties: 0,
      properties: {},
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["source"],
      properties: { source: { type: "string" } },
    },
    execute(context, input) {
      return execute(context, input);
    },
  });
  return definePack({
    ...demoPack.manifest,
    id,
    tools: [tool],
    fixtures: [
      {
        id: "source",
        tool: DEMO_TOOL_NAME,
        input: {},
        expect: { kind: "result", result: { source: "pack" } },
      },
    ],
  });
}

export function setupExtension() {
  const runtime = new FakeRuntime();
  const scheduler = new FakeScheduler();
  const supervisor = startExtensionRuntime(runtime, {
    ...TEST_OPTIONS,
    scheduler,
  });
  return { runtime, scheduler, supervisor, port: runtime.latestPort };
}

export function readyExtension() {
  const state = setupExtension();
  state.port.emitMessage(helloAck());
  return state;
}

export function helloAck(
  overrides: Partial<ReturnType<typeof baseHelloAck>> = {},
) {
  return { ...baseHelloAck(), ...overrides };
}

export function toolCall(overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "tool_call",
    requestId: "request-1",
    contextId: DEMO_CONTEXT_ID,
    contextRevision: 1,
    origin: DEMO_ORIGIN,
    tool: DEMO_TOOL_NAME,
    args: {},
    ...overrides,
  };
}

export async function flushPromises(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function baseHelloAck() {
  return {
    protocolVersion: PROTOCOL_VERSION,
    type: "hello_ack" as const,
    supportedProtocolVersions: [PROTOCOL_VERSION],
    selectedProtocolVersion: PROTOCOL_VERSION,
    connectionId: "connection-1",
    implementation: { name: "mcpatch-bridge", version: "0.1.0" },
  };
}
