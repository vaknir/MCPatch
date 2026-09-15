import {
  PackToolExecutionError,
  type JsonObject,
  type PackExecutionContext,
  type PackFixtureErrorCode,
} from "@mcpatch/sdk/runtime";
import type { JsonObject as ProtocolJsonObject } from "@mcpatch/protocol";

import type { NativeRuntimeTool } from "./compiled-pack-model.js";
import type { PageNativeCapability } from "./page-channel.js";
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
      .map((capability) =>
        Object.freeze({
          tool: Object.freeze({
            name: capability.name,
            ...(capability.title === undefined
              ? {}
              : { title: capability.title }),
            description: capability.description,
            risk: "read" as const,
            permissions: Object.freeze(["READ"] as const),
            inputSchema: capability.inputSchema,
            // Draft WebMCP does not advertise result schemas. The page channel
            // still bounds and validates every returned JSON value.
            outputSchema: UNCONSTRAINED_JSON_SCHEMA,
          }),
          async execute(context: PackExecutionContext, input: JsonObject) {
            try {
              return await invoker.invoke(
                snapshot.binding.contextId,
                capability.name,
                input as unknown as ProtocolJsonObject,
                context.signal,
              );
            } catch (error) {
              if (error instanceof PageInvocationError) {
                throw new PackToolExecutionError(toPackErrorCode(error.code));
              }
              throw error;
            }
          },
        }),
      ),
  );
}

function toPackErrorCode(code: PageInvocationErrorCode): PackFixtureErrorCode {
  return code === "TOOL_UNAVAILABLE" ? "TOOL_NOT_FOUND" : code;
}
