import type {
  ChromeActionApi,
  ChromeActionTab,
  ChromeEnablementApi,
  ChromePermissionSet,
  ChromePermissionsApi,
  ChromeRegisteredContentScript,
  ChromeScriptingApi,
  ChromeStorageApi,
  ChromeStorageAreaApi,
  ChromeStorageChange,
} from "../../src/enablement-model.js";
import type {
  ChromeRuntimeLifecycleApi,
  InstalledDetails,
} from "../../src/lifecycle.js";
import { FakeChromeEvent } from "./native-session.js";

export class FakeEnablementApi implements ChromeEnablementApi {
  readonly action = new FakeAction();
  readonly lifecycle: ChromeRuntimeLifecycleApi = {
    onInstalled: new FakeChromeEvent<[InstalledDetails]>(),
    onStartup: new FakeChromeEvent<[]>(),
  };
  readonly permissions = new FakePermissions();
  readonly scripting = new FakeScripting();
  readonly storage = new FakeStorage();
  readonly log: string[] = [];

  constructor() {
    this.permissions.log = this.log;
    this.scripting.log = this.log;
    this.storage.log = this.log;
  }
}

export class FakeAction implements ChromeActionApi {
  readonly onClicked = new FakeChromeEvent<[ChromeActionTab]>();
  readonly badges: Array<{
    readonly color?: string;
    readonly tabId: number;
    readonly text?: string;
    readonly title?: string;
  }> = [];

  async setBadgeBackgroundColor(details: {
    readonly color: string;
    readonly tabId: number;
  }): Promise<void> {
    this.badges.push(details);
  }

  async setBadgeText(details: {
    readonly tabId: number;
    readonly text: string;
  }): Promise<void> {
    this.badges.push(details);
  }

  async setTitle(details: {
    readonly tabId: number;
    readonly title: string;
  }): Promise<void> {
    this.badges.push(details);
  }
}

export class FakePermissions implements ChromePermissionsApi {
  readonly onAdded = new FakeChromeEvent<[ChromePermissionSet]>();
  readonly onRemoved = new FakeChromeEvent<[ChromePermissionSet]>();
  readonly granted = new Set<string>();
  readonly requests: ChromePermissionSet[] = [];
  log: string[] = [];
  nextRequest = true;
  throwContains = false;

  async contains(permissions: ChromePermissionSet): Promise<boolean> {
    if (this.throwContains) throw new Error("contains failed");
    return origins(permissions).every((origin) => this.granted.has(origin));
  }

  async remove(permissions: ChromePermissionSet): Promise<boolean> {
    this.log.push("permission.remove");
    let removed = false;
    for (const origin of origins(permissions)) {
      removed = this.granted.delete(origin) || removed;
    }
    if (removed) this.onRemoved.emit(permissions);
    return removed;
  }

  async request(permissions: ChromePermissionSet): Promise<boolean> {
    this.requests.push(structuredClone(permissions));
    this.log.push("permission.request");
    if (!this.nextRequest) return false;
    for (const origin of origins(permissions)) this.granted.add(origin);
    this.onAdded.emit(permissions);
    return true;
  }
}

export class FakeScripting implements ChromeScriptingApi {
  readonly registrations = new Map<string, ChromeRegisteredContentScript>();
  log: string[] = [];
  throwGet = false;

  async getRegisteredContentScripts(): Promise<
    readonly ChromeRegisteredContentScript[]
  > {
    if (this.throwGet) throw new Error("get scripts failed");
    return [...this.registrations.values()].map((script) =>
      structuredClone(script),
    );
  }

  async registerContentScripts(
    scripts: readonly ChromeRegisteredContentScript[],
  ): Promise<void> {
    this.log.push("scripts.register");
    for (const script of scripts) {
      if (this.registrations.has(script.id))
        throw new Error("duplicate script");
      this.registrations.set(script.id, structuredClone(script));
    }
  }

  async unregisterContentScripts(filter: {
    readonly ids: readonly string[];
  }): Promise<void> {
    this.log.push("scripts.unregister");
    for (const id of filter.ids) this.registrations.delete(id);
  }
}

export class FakeStorage implements ChromeStorageApi {
  readonly data: Record<string, unknown> = {};
  readonly local: ChromeStorageAreaApi;
  readonly onChanged = new FakeChromeEvent<
    [
      Record<string, ChromeStorageChange>,
      "local" | "managed" | "session" | "sync",
    ]
  >();
  accessLevels: string[] = [];
  log: string[] = [];
  throwAccess = false;
  throwSet = false;

  constructor() {
    this.local = {
      get: async (key) => {
        this.log.push("storage.get");
        return Object.hasOwn(this.data, key)
          ? { [key]: structuredClone(this.data[key]) }
          : {};
      },
      remove: async (key) => {
        this.log.push("storage.remove");
        const oldValue = this.data[key];
        Reflect.deleteProperty(this.data, key);
        this.onChanged.emit({ [key]: { oldValue } }, "local");
      },
      set: async (items) => {
        if (this.throwSet) throw new Error("storage set failed");
        this.log.push("storage.set");
        for (const [key, value] of Object.entries(items)) {
          const oldValue = this.data[key];
          this.data[key] = structuredClone(value);
          this.onChanged.emit(
            { [key]: { newValue: this.data[key], oldValue } },
            "local",
          );
        }
      },
      setAccessLevel: async ({ accessLevel }) => {
        if (this.throwAccess) throw new Error("access level failed");
        this.log.push("storage.access");
        this.accessLevels.push(accessLevel);
      },
    };
  }
}

function origins(permissions: ChromePermissionSet): readonly string[] {
  return permissions.origins ?? [];
}
