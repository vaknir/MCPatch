import {
  imageResult,
  PackToolExecutionError,
  type JsonObject,
  type PackExecutionContext,
  type PackFixtureErrorCode,
} from "@mcpatch/sdk/runtime";
import type { JsonObject as ProtocolJsonObject } from "@mcpatch/protocol";

import { nativeToolName } from "./native-tool-name.js";

import type {
  NativeRuntimeTool,
  PageRuntimeTool,
} from "./compiled-pack-model.js";
import type {
  PageNativeCapability,
  PagePackCapability,
} from "./page-channel.js";
import {
  PageInvocationError,
  type PageContextSnapshot,
  type PageInvocationErrorCode,
  type PageInvoker,
} from "./page-context-model.js";

const UNCONSTRAINED_JSON_SCHEMA = Object.freeze({});

export function projectPageNativeTools(
  snapshot: PageContextSnapshot,
  invoker: PageInvoker,
): readonly NativeRuntimeTool[] {
  return Object.freeze(
    snapshot.capabilities
      .filter(
        (capability): capability is PageNativeCapability =>
          capability.source === "native_webmcp",
      )
      .flatMap((capability) => {
        // Published under the reserved native namespace so a page cannot list
        // a tool beside a reviewed pack's tool of the same name. Execution
        // still addresses the page by the name the page itself declared.
        const name = nativeToolName(snapshot.binding.origin, capability.name);
        if (name === undefined) return [];
        return [
          Object.freeze({
            tool: Object.freeze({
              name,
              ...(capability.title === undefined
                ? {}
                : { title: capability.title }),
              description: capability.description,
              risk: "read" as const,
              permissions: Object.freeze(["READ"] as const),
              inputSchema: capability.inputSchema,
              // Draft WebMCP does not advertise result schemas. The page
              // channel still bounds and validates every returned JSON value.
              outputSchema: UNCONSTRAINED_JSON_SCHEMA,
            }),
            execute: pageExecution(snapshot, capability.name, invoker),
          }),
        ];
      }),
  );
}

export function projectPagePackTools(
  snapshot: PageContextSnapshot,
  invoker: PageInvoker,
): readonly PageRuntimeTool[] {
  return Object.freeze(
    snapshot.capabilities
      .filter(
        (capability): capability is PagePackCapability =>
          capability.source === "pack",
      )
      .map((capability) =>
        Object.freeze({
          name: capability.name,
          execute: pageExecution(snapshot, capability.name, invoker),
        }),
      ),
  );
}

function pageExecution(
  snapshot: PageContextSnapshot,
  tool: string,
  invoker: PageInvoker,
) {
  return async (context: PackExecutionContext, input: JsonObject) => {
    try {
      const execution = await invoker.invoke(
        snapshot.binding.contextId,
        tool,
        input as unknown as ProtocolJsonObject,
        context.signal,
      );
      const image = execution.content?.[0];
      return image === undefined
        ? execution.result
        : imageResult(execution.result, image);
    } catch (error) {
      if (error instanceof PageInvocationError) {
        throw new PackToolExecutionError(toPackErrorCode(error.code));
      }
      throw error;
    }
  };
}

function toPackErrorCode(code: PageInvocationErrorCode): PackFixtureErrorCode {
  return code === "TOOL_UNAVAILABLE" ? "TOOL_NOT_FOUND" : code;
}
