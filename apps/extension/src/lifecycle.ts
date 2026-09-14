export interface ChromeEvent<Arguments extends unknown[]> {
  addListener(listener: (...arguments_: Arguments) => void): void;
}

export type InstalledReason =
  "install" | "update" | "chrome_update" | "shared_module_update";

export interface InstalledDetails {
  reason: InstalledReason;
}

export interface ChromeRuntimeLifecycleApi {
  onInstalled: ChromeEvent<[InstalledDetails]>;
  onStartup: ChromeEvent<[]>;
}

export type LifecycleWake =
  { type: "installed"; reason: InstalledReason } | { type: "startup" };

export function registerLifecycleListeners(
  runtime: ChromeRuntimeLifecycleApi,
  wake: (event: LifecycleWake) => void,
): void {
  runtime.onInstalled.addListener((details) => {
    wake({ type: "installed", reason: details.reason });
  });
  runtime.onStartup.addListener(() => {
    wake({ type: "startup" });
  });
}
