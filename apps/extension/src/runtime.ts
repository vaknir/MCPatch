import { DEMO_CONTEXT_ID, DEMO_URL } from "@mcpatch/example-packs";

import { BUNDLED_PACKS, PACK_RUNTIME_OPTIONS } from "./bundled-packs.js";
import { CompiledPackRuntime } from "./compiled-pack-runtime.js";
import type { ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import { registerLifecycleListeners } from "./lifecycle.js";
import {
  NativeSessionSupervisor,
  type ChromeNativeRuntimeApi,
  type NativeSessionOptions,
  type SessionScheduler,
} from "./native-session.js";
import { denyPageAuthority, PageContextOwner } from "./page-context-owner.js";
import type {
  ChromePageServiceRuntimeApi,
  PageAuthority,
  PageContextOwnerHooks,
} from "./page-context-model.js";

export type ExtensionRuntimeApi = ChromeRuntimeLifecycleApi &
  ChromeNativeRuntimeApi &
  ChromePageServiceRuntimeApi;

export interface ExtensionRuntimeOptions
  extends NativeSessionOptions, PageContextOwnerHooks {
  readonly pageAuthority?: PageAuthority;
  readonly pageCallTimeoutMs?: number;
  readonly pageHandshakeTimeoutMs?: number;
  readonly onPageContextOwner?: (owner: PageContextOwner) => void;
  readonly pageRandomId?: () => string;
  readonly pageScheduler?: SessionScheduler;
}

export function startExtensionRuntime(
  runtime: ExtensionRuntimeApi,
  options: ExtensionRuntimeOptions = {},
): NativeSessionSupervisor {
  let bridgeReady = false;
  const pageContexts = new PageContextOwner(runtime, {
    authority: {
      authorize(identity) {
        if (!bridgeReady) return undefined;
        return (options.pageAuthority ?? denyPageAuthority).authorize(identity);
      },
    },
    ...(options.pageCallTimeoutMs === undefined
      ? {}
      : { callTimeoutMs: options.pageCallTimeoutMs }),
    ...(options.pageHandshakeTimeoutMs === undefined
      ? {}
      : { handshakeTimeoutMs: options.pageHandshakeTimeoutMs }),
    ...(options.onClosed === undefined ? {} : { onClosed: options.onClosed }),
    ...(options.onSnapshot === undefined
      ? {}
      : { onSnapshot: options.onSnapshot }),
    ...(options.pageRandomId === undefined
      ? {}
      : { randomId: options.pageRandomId }),
    ...((options.pageScheduler ?? options.scheduler) === undefined
      ? {}
      : { scheduler: options.pageScheduler ?? options.scheduler }),
  });
  options.onPageContextOwner?.(pageContexts);
  const session: { supervisor?: NativeSessionSupervisor } = {};
  const packs = new CompiledPackRuntime(
    (message) => session.supervisor?.send(message) ?? false,
    BUNDLED_PACKS,
    PACK_RUNTIME_OPTIONS,
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
      bridgeReady = false;
      packs.disconnect();
      pageContexts.closeAll("disconnected");
      options.onDisconnected?.();
    },
    onReady() {
      bridgeReady = true;
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
      bridgeReady = false;
      packs.closeAll("disconnected");
      pageContexts.closeAll("disconnected");
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
