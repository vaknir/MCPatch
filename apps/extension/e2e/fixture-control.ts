import {
  ENABLEMENT_STORAGE_KEY,
  ENABLEMENT_STATE_VERSION,
  type ChromePermissionsApi,
  type ChromeStorageApi,
} from "../src/enablement-model.js";
import {
  FIXTURE_MARKER,
  FIXTURE_ORIGIN,
  FIXTURE_PERMISSION,
} from "./fixture-constants.js";
import { fixturePack } from "./fixture-pack.js";

declare const chrome: {
  readonly permissions: ChromePermissionsApi;
  readonly storage: ChromeStorageApi;
};

const record = Object.freeze({
  publisher: fixturePack.manifest.publisher,
  id: fixturePack.manifest.id,
  version: fixturePack.manifest.version,
  digest: fixturePack.manifest.digest,
  origin: FIXTURE_ORIGIN,
});
const status = requiredElement<HTMLOutputElement>("fixture-status");
const enable = requiredElement<HTMLButtonElement>("fixture-enable");
const disable = requiredElement<HTMLButtonElement>("fixture-disable");

void FIXTURE_MARKER;

enable.addEventListener("click", () => {
  void setEnabled(true);
});
disable.addEventListener("click", () => {
  void setEnabled(false);
});
void refreshStatus();

async function setEnabled(enabled: boolean): Promise<void> {
  setWorking();
  try {
    if (enabled) {
      await chrome.storage.local.set({
        [ENABLEMENT_STORAGE_KEY]: {
          stateVersion: ENABLEMENT_STATE_VERSION,
          enabled: [record],
        },
      });
    } else {
      await chrome.storage.local.set({
        [ENABLEMENT_STORAGE_KEY]: {
          stateVersion: ENABLEMENT_STATE_VERSION,
          enabled: [],
        },
      });
    }
    await refreshStatus();
  } catch {
    setStatus("failed", false);
  }
}

async function refreshStatus(): Promise<void> {
  const inventory = await chrome.permissions.getAll();
  const granted = (inventory.origins ?? []).includes(FIXTURE_PERMISSION);
  const stored = await chrome.storage.local.get(ENABLEMENT_STORAGE_KEY);
  const state = stored[ENABLEMENT_STORAGE_KEY];
  const requested =
    typeof state === "object" &&
    state !== null &&
    Array.isArray((state as { readonly enabled?: unknown }).enabled) &&
    (state as { readonly enabled: readonly unknown[] }).enabled.length === 1;
  setStatus(granted && requested ? "enabled" : "disabled", requested);
}

function setWorking(): void {
  enable.disabled = true;
  disable.disabled = true;
  status.value = "working";
  status.dataset["state"] = "working";
}

function setStatus(value: string, enabled: boolean): void {
  status.value = value;
  status.textContent = value;
  status.dataset["state"] = value;
  enable.disabled = enabled;
  disable.disabled = !enabled;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.querySelector<HTMLElement>(`#${id}`);
  if (element === null) throw new Error(`missing fixture control ${id}`);
  return element as T;
}
