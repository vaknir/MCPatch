import type { ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import { registerLifecycleListeners } from "./lifecycle.js";
import { DemoCapabilityRuntime } from "./demo-capability.js";
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
  const demo = new DemoCapabilityRuntime(
    (message) => session.supervisor?.send(message) ?? false,
  );
  const supervisorOptions: NativeSessionOptions = {
    ...options,
    onMessage(message) {
      if (demo.handle(message)) return;
      if (options.onMessage === undefined) {
        throw new Error("unsupported bridge application message");
      }
      options.onMessage(message);
    },
    onReady() {
      demo.publish();
      options.onReady?.();
    },
    onStopping() {
      demo.close();
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
