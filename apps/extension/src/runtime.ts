import { DEMO_CONTEXT_ID, DEMO_URL } from "@mcpatch/example-packs";
import type { ContextClosedReason } from "@mcpatch/protocol";

import { BUNDLED_PACKS, PACK_RUNTIME_OPTIONS } from "./bundled-packs.js";
import { CompiledPackRuntime } from "./compiled-pack-runtime.js";
import type {
  CompiledPackRuntimeOptions,
  CompiledPackSubject,
} from "./compiled-pack-validation.js";
import type { ChromeRuntimeLifecycleApi } from "./lifecycle.js";
import { registerLifecycleListeners } from "./lifecycle.js";
import {
  NativeSessionSupervisor,
  type ChromeNativeRuntimeApi,
  type NativeSessionOptions,
  type SessionScheduler,
} from "./native-session.js";
import { denyPageAuthority, PageContextOwner } from "./page-context-owner.js";
import {
  projectPageNativeTools,
  projectPagePackTools,
} from "./page-capability-projection.js";
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
  readonly compiledPacks?: readonly CompiledPackSubject[];
  readonly compiledPackRuntimeOptions?: CompiledPackRuntimeOptions;
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
  const packState: { runtime?: CompiledPackRuntime } = {};
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
    onClosed(contextId, reason) {
      packState.runtime?.closeContext(contextId, toContextClosedReason(reason));
      options.onClosed?.(contextId, reason);
    },
    onSnapshot(snapshot) {
      const activation = packState.runtime?.activateContext({
        contextId: snapshot.binding.contextId,
        url: snapshot.url,
        native: projectPageNativeTools(snapshot, pageContexts),
        page: projectPagePackTools(snapshot, pageContexts),
      });
      if (activation === undefined || !activation.ok) {
        throw new Error("page capability projection failed");
      }
      options.onSnapshot?.(snapshot);
    },
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
    options.compiledPacks ?? BUNDLED_PACKS,
    options.compiledPackRuntimeOptions ?? PACK_RUNTIME_OPTIONS,
  );
  packState.runtime = packs;
  const supervisorOptions: NativeSessionOptions = {
    ...options,
    onMessage(message) {
      if (packs.handle(message)) return;
      if (message.type === "approval_required") {
        if (!(
          session.supervisor?.send({
            protocolVersion: message.protocolVersion,
            type: "approval_result",
            approvalId: message.approvalId,
            requestId: message.requestId,
            decision: "denied",
          }) ?? false
        )) {
          throw new Error("approval denial could not be delivered");
        }
        return;
      }
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

function toContextClosedReason(
  reason: "disconnected" | "navigation" | "pack_disabled",
): ContextClosedReason {
  return reason;
}
