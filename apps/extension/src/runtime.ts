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
  const supervisor = new NativeSessionSupervisor(runtime, options);
  registerLifecycleListeners(runtime, () => {
    supervisor.wake();
  });
  supervisor.wake();
  return supervisor;
}
