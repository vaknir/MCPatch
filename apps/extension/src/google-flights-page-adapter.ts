import {
  GoogleFlightsAdapterError,
  createGoogleFlightsDocumentSource,
  createGoogleFlightsPageAdapter as createPackAdapter,
} from "@mcpatch/google-flights-pack";
import type { JsonValue } from "@mcpatch/protocol";

import {
  PageAdapterExecutionError,
  type PageAdapter,
} from "./page-content-model.js";

/** Maps the independently packaged adapter onto the extension page contract. */
export function createGoogleFlightsPageAdapter(
  document: Document,
): PageAdapter {
  const adapter = createPackAdapter(
    createGoogleFlightsDocumentSource(document),
  );
  return {
    async capabilities(signal) {
      try {
        return await adapter.capabilities(signal);
      } catch (error) {
        throw mapAdapterError(error);
      }
    },
    async execute(tool, args, signal) {
      try {
        return (await adapter.execute(
          tool,
          args,
          signal,
        )) as unknown as JsonValue;
      } catch (error) {
        throw mapAdapterError(error);
      }
    },
    subscribe(listener) {
      return adapter.subscribe(listener);
    },
  };
}

function mapAdapterError(error: unknown): PageAdapterExecutionError {
  if (error instanceof PageAdapterExecutionError) return error;
  if (error instanceof GoogleFlightsAdapterError) {
    return new PageAdapterExecutionError(error.code);
  }
  return new PageAdapterExecutionError("EXECUTION_FAILED");
}
