import { MAX_DECLARATIVE_BUNDLE_BYTES } from "@mcpatch/sdk/runtime";

import type {
  LocalPackCandidateSummary,
  LocalPackResult,
  LocalPackSummary,
} from "./local-pack-model.js";

interface DeveloperChromeApi {
  readonly permissions: {
    request(value: { readonly origins: readonly string[] }): Promise<boolean>;
  };
  readonly runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
}

declare const chrome: DeveloperChromeApi;

const mode = element<HTMLInputElement>("developer-mode");
const file = element<HTMLInputElement>("pack-file");
const preview = element<HTMLElement>("preview");
const replacement = element<HTMLElement>("replacement");
const confirmImport = element<HTMLButtonElement>("confirm-import");
const cancelImport = element<HTMLButtonElement>("cancel-import");
const installed = element<HTMLUListElement>("installed-packs");
const empty = element<HTMLElement>("empty-packs");
const status = element<HTMLElement>("status");
let candidate: LocalPackCandidateSummary | undefined;
let busy = false;

mode.addEventListener("change", () => {
  void run(async () => {
    const result = await request<{ readonly developerMode: boolean }>({
      type: "local_pack_set_developer_mode",
      enabled: mode.checked,
    });
    if (!result.ok) throw new UiError(result.error.code);
    await refresh();
    showStatus(
      result.value.developerMode
        ? "Developer mode enabled."
        : "Developer mode disabled; local authority was removed.",
      "success",
    );
  });
});

file.addEventListener("change", () => {
  void run(async () => {
    const selected = file.files?.item(0);
    if (selected === null || selected === undefined) return;
    if (selected.size === 0 || selected.size > MAX_DECLARATIVE_BUNDLE_BYTES) {
      throw new UiError("TOO_LARGE");
    }
    const bytes = new Uint8Array(await selected.arrayBuffer());
    const result = await request<LocalPackCandidateSummary>({
      type: "local_pack_preview",
      base64: encodeBase64(bytes),
    });
    if (!result.ok) throw new UiError(result.error.code);
    candidate = result.value;
    renderPreview(result.value);
  });
});

cancelImport.addEventListener("click", () => clearPreview());

confirmImport.addEventListener("click", () => {
  void run(async () => {
    const selected = candidate;
    if (selected === undefined) throw new UiError("CANDIDATE_EXPIRED");
    const granted = await chrome.permissions.request({
      origins: selected.origins.map((origin) => `${origin}/*`),
    });
    if (!granted) throw new UiError("PERMISSION_REQUIRED");
    const result = await request<LocalPackSummary>({
      type: "local_pack_install",
      candidateToken: selected.candidateToken,
    });
    if (!result.ok) throw new UiError(result.error.code);
    clearPreview();
    await refresh();
    showStatus(
      "The exact unsigned bundle is installed and enabled.",
      "success",
    );
  });
});

void run(refresh);

async function refresh(): Promise<void> {
  const result = await request<{
    readonly developerMode: boolean;
    readonly packs: readonly LocalPackSummary[];
  }>({ type: "local_pack_list" });
  if (!result.ok) throw new UiError(result.error.code);
  mode.checked = result.value.developerMode;
  file.disabled = !result.value.developerMode;
  renderInstalled(result.value.packs);
  if (!result.value.developerMode) clearPreview();
}

function renderPreview(value: LocalPackCandidateSummary): void {
  text("preview-name", `${value.publisher}/${value.id} — ${value.name}`);
  text("preview-version", value.version);
  text("preview-digest", value.digest);
  replacement.hidden = !value.replacement;
  replaceChildren(
    element("preview-origins"),
    value.origins.map((origin) => rowText("li", "list-row", origin)),
  );
  replaceChildren(
    element("preview-tools"),
    value.tools.map((tool) => {
      const row = document.createElement("tr");
      row.append(
        cell(`${tool.name}\n${tool.description}`),
        cell(tool.risk),
        cell(tool.permissions.join(", ")),
      );
      return row;
    }),
  );
  preview.hidden = false;
  preview.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderInstalled(packs: readonly LocalPackSummary[]): void {
  empty.hidden = packs.length !== 0;
  replaceChildren(
    installed,
    packs.map((pack) => {
      const item = document.createElement("li");
      item.className = "list-row border-base-300 border";
      const details = document.createElement("div");
      details.className = "list-col-grow min-w-0";
      const heading = document.createElement("div");
      heading.className = "flex flex-wrap items-center gap-2 font-semibold";
      heading.append(
        document.createTextNode(`${pack.publisher}/${pack.id}`),
        badge("UNSIGNED", "badge-warning"),
        badge(
          pack.enabled ? "Enabled" : "Disabled",
          pack.enabled ? "badge-success" : "badge-ghost",
        ),
      );
      const digest = rowText(
        "p",
        "mt-1 font-mono text-xs break-all",
        pack.digest,
      );
      const authority = rowText(
        "p",
        "text-base-content/70 mt-1 text-sm break-all",
        `${pack.origins.join(", ")} · ${pack.tools.length} tool${pack.tools.length === 1 ? "" : "s"}`,
      );
      details.append(heading, digest, authority);

      const actions = document.createElement("div");
      actions.className = "flex flex-wrap items-center justify-end gap-2";
      const toggle = button(pack.enabled ? "Disable" : "Enable");
      toggle.addEventListener("click", () => {
        void run(async () => {
          if (!pack.enabled) {
            const granted = await chrome.permissions.request({
              origins: pack.origins.map((origin) => `${origin}/*`),
            });
            if (!granted) throw new UiError("PERMISSION_REQUIRED");
          }
          const result = await request<LocalPackSummary>({
            type: "local_pack_set_enabled",
            installId: pack.installId,
            enabled: !pack.enabled,
          });
          if (!result.ok) throw new UiError(result.error.code);
          await refresh();
        });
      });
      const remove = button("Uninstall", "btn-error", "btn-outline");
      remove.addEventListener("click", () => {
        void run(async () => {
          const result = await request<{ readonly removed: true }>({
            type: "local_pack_uninstall",
            installId: pack.installId,
          });
          if (!result.ok) throw new UiError(result.error.code);
          await refresh();
          showStatus("Local pack uninstalled.", "success");
        });
      });
      actions.append(toggle, remove);
      item.append(details, actions);
      return item;
    }),
  );
}

async function request<T>(message: unknown): Promise<LocalPackResult<T>> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as LocalPackResult<T>;
  if (
    typeof response !== "object" ||
    response === null ||
    !("ok" in response)
  ) {
    throw new UiError("INVALID_MESSAGE");
  }
  return response;
}

async function run(operation: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  setDisabled(true);
  try {
    await operation();
  } catch (error) {
    showStatus(
      error instanceof UiError
        ? `MCPatch refused the operation: ${error.code}.`
        : "MCPatch refused the operation.",
      "error",
    );
  } finally {
    busy = false;
    setDisabled(false);
  }
}

function setDisabled(value: boolean): void {
  mode.disabled = value;
  confirmImport.disabled = value;
  cancelImport.disabled = value;
  file.disabled = value || !mode.checked;
  for (const control of installed.querySelectorAll("button")) {
    control.disabled = value;
  }
}

function clearPreview(): void {
  candidate = undefined;
  preview.hidden = true;
  file.value = "";
}

function showStatus(message: string, kind: "error" | "success"): void {
  status.textContent = message;
  status.className = `alert ${kind === "error" ? "alert-error" : "alert-success"}`;
  status.hidden = false;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 16_384;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

function button(label: string, ...modifiers: string[]): HTMLButtonElement {
  const value = document.createElement("button");
  value.type = "button";
  value.className = ["btn", "btn-sm", ...modifiers].join(" ");
  value.textContent = label;
  return value;
}

function badge(label: string, modifier: string): HTMLSpanElement {
  const value = document.createElement("span");
  value.className = `badge badge-sm ${modifier}`;
  value.textContent = label;
  return value;
}

function cell(value: string): HTMLTableCellElement {
  const result = document.createElement("td");
  result.className = "whitespace-pre-line break-all";
  result.textContent = value;
  return result;
}

function rowText<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  value: string,
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = value;
  return result;
}

function replaceChildren(parent: Element, children: readonly Node[]): void {
  parent.replaceChildren(...children);
}

function text(id: string, value: string): void {
  element(id).textContent = value;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`missing developer page element: ${id}`);
  return value as T;
}

class UiError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
