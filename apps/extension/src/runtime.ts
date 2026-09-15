import { DEMO_CONTEXT_ID, DEMO_URL, demoPack } from "@mcpatch/example-packs";
import { PROTOCOL_VERSION } from "@mcpatch/protocol";

import { CompiledPackRuntime } from "./compiled-pack-runtime.js";
import type { ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import { registerLifecycleListeners } from "./lifecycle.js";
import {
  NativeSessionSupervisor,
  type ChromeNativeRuntimeApi,
  type NativeSessionOptions,
} from "./native-session.js";

export type ExtensionRuntimeApi = ChromeRuntimeLifecycleApi &
  ChromeNativeRuntimeApi;

export function startExtensionRuntime(
  runtime: ExtensionRuntimeApi,
  options: NativeSessionOptions = {},
): NativeSessionSupervisor {
  const session: { supervisor?: NativeSessionSupervisor } = {};
  const packs = new CompiledPackRuntime(
    (message) => session.supervisor?.send(message) ?? false,
    [demoPack],
    {
      runtimeVersion: "0.1.0",
      bridgeProtocolVersion: PROTOCOL_VERSION,
      allowedPermissions: ["READ"],
    },
  );
  const supervisorOptions: NativeSessionOptions = {
    ...options,
    onMessage(message) {
      if (packs.handle(message)) return;
      if (options.onMessage === undefined) {
        throw new Error("unsupported bridge application message");
      }
      options.onMessage(message);
    },
    onDisconnected() {
      packs.disconnect();
      options.onDisconnected?.();
    },
    onReady() {
      const activation = packs.activateContext({
        contextId: DEMO_CONTEXT_ID,
        url: DEMO_URL,
        native: [],
      });
      if (!activation.ok || !activation.published) {
        throw new Error("synthetic pack activation failed");
      }
      options.onReady?.();
    },
    onStopping() {
      packs.closeAll("disconnected");
      options.onStopping?.();
    },
  };
  const supervisor = new NativeSessionSupervisor(runtime, supervisorOptions);
  session.supervisor = supervisor;
  registerLifecycleListeners(runtime, () => {
    supervisor.wake();
  });
  supervisor.wake();
  return supervisor;
}
