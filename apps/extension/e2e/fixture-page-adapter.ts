import type { JsonObject, JsonValue } from "@mcpatch/protocol";

import type { PageCapability } from "../src/page-channel.js";
import {
  PageAdapterExecutionError,
  type PageAdapter,
} from "../src/page-content-model.js";
import {
  FIXTURE_ORIGIN,
  FIXTURE_STATE_TOOL,
  FIXTURE_WAIT_TOOL,
} from "./fixture-constants.js";

const capabilities: readonly PageCapability[] = Object.freeze([
  Object.freeze({
    source: "pack" as const,
    name: FIXTURE_STATE_TOOL,
  }),
  Object.freeze({
    source: "pack" as const,
    name: FIXTURE_WAIT_TOOL,
  }),
]);

export function createFixturePageAdapter(document: Document): PageAdapter {
  if (globalThis.location.origin !== FIXTURE_ORIGIN) {
    throw new TypeError("fixture adapter origin mismatch");
  }
  return {
    async capabilities(signal) {
      signal.throwIfAborted();
      return capabilities;
    },
    async execute(tool, _args, signal): Promise<JsonValue> {
      signal.throwIfAborted();
      if (tool === FIXTURE_STATE_TOOL) return currentState(document);
      if (tool === FIXTURE_WAIT_TOOL)
        return waitForCancellation(document, signal);
      throw new PageAdapterExecutionError("TOOL_UNAVAILABLE");
    },
    subscribe(listener) {
      const state = requiredStateElement(document);
      const observer = new MutationObserver(listener);
      observer.observe(state, {
        attributes: true,
        attributeFilter: ["data-revision"],
        characterData: true,
        childList: true,
        subtree: true,
      });
      return () => observer.disconnect();
    },
  };
}

function currentState(document: Document): JsonObject {
  const state = requiredStateElement(document);
  const revision = Number(state.dataset["revision"]);
  const value = state.textContent?.trim() ?? "";
  if (!Number.isSafeInteger(revision) || revision < 0 || value === "") {
    throw new PageAdapterExecutionError("RESULT_INVALID");
  }
  return { revision, value };
}

function requiredStateElement(document: Document): HTMLElement {
  const element = document.querySelector<HTMLElement>("#fixture-value");
  if (element === null) {
    throw new PageAdapterExecutionError("EXECUTION_FAILED");
  }
  return element;
}

function waitForCancellation(
  document: Document,
  signal: AbortSignal,
): Promise<JsonValue> {
  document.documentElement.dataset["fixtureWait"] = "running";
  return new Promise((_resolve, reject) => {
    const cancelled = () => {
      document.documentElement.dataset["fixtureWait"] = "cancelled";
      reject(new PageAdapterExecutionError("CANCELLED"));
    };
    if (signal.aborted) {
      cancelled();
      return;
    }
    signal.addEventListener("abort", cancelled, { once: true });
  });
}
