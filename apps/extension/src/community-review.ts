import type {
  CommunityPackResult,
  CommunityPackReview,
} from "./community-pack-model.js";

interface ReviewChromeApi {
  readonly permissions: {
    request(value: { readonly origins: readonly string[] }): Promise<boolean>;
  };
  readonly runtime: {
    sendMessage(message: unknown): Promise<unknown>;
  };
}

declare const chrome: ReviewChromeApi;

const install = element<HTMLButtonElement>("install");
const cancel = element<HTMLButtonElement>("cancel");
const status = element<HTMLElement>("status");
const candidateToken = new URL(location.href).searchParams.get("candidate");
let review: CommunityPackReview | undefined;

cancel.addEventListener("click", () => window.close());
install.addEventListener("click", () => {
  const selected = review;
  if (selected === undefined) return;
  setDisabled(true);
  // This request must remain the first asynchronous operation in the trusted
  // click turn. Its exact patterns were staged and rendered before the gesture.
  let permission: Promise<boolean>;
  try {
    permission = chrome.permissions.request({
      origins: selected.origins.map((origin) => `${origin}/*`),
    });
  } catch {
    showFailure("PERMISSION_REQUIRED");
    return;
  }
  void permission.then(
    async (granted) => {
      if (!granted) {
        showFailure("PERMISSION_REQUIRED");
        return;
      }
      const result = await request<{ readonly installed: true }>({
        type: "community_pack_install",
        candidateToken: selected.candidateToken,
      });
      if (!result.ok) {
        showFailure(result.error.code);
        return;
      }
      status.textContent =
        selected.kind === "rollback"
          ? "The verified rollback is active."
          : selected.kind === "update"
            ? "The verified update is active."
            : "The verified pack is installed and enabled.";
      status.className = "alert alert-success";
      status.hidden = false;
      install.textContent = "Installed";
      install.disabled = true;
      cancel.textContent = "Close";
      cancel.disabled = false;
    },
    () => showFailure("PERMISSION_REQUIRED"),
  );
});

void load();

async function load(): Promise<void> {
  if (
    candidateToken === null ||
    !/^candidate\.[a-f0-9]{32}$/u.test(candidateToken)
  ) {
    showFailure("CANDIDATE_EXPIRED");
    return;
  }
  const result = await request<CommunityPackReview>({
    type: "community_pack_review_get",
    candidateToken,
  });
  if (!result.ok) {
    showFailure(result.error.code);
    return;
  }
  review = result.value;
  render(result.value);
  setDisabled(false);
}

function render(value: CommunityPackReview): void {
  text("trust", value.trust);
  text("change-kind", value.kind.toUpperCase());
  text("identity-title", value.name);
  text("description", value.description);
  text("identity", `${value.publisher}/${value.id}`);
  text("version", value.version);
  text("digest", value.digest);
  text("publisher-key", value.publisherPublicKey);
  text("registry-key", value.registryKeyId);
  text(
    "network-policy",
    value.networkPolicy.extensionRequests === "none"
      ? "External network: none. The pack reads only the current matching document."
      : "External network authority is declared.",
  );
  text(
    "tests",
    `${value.verification.fixtureTestsPassed}/${value.verification.fixtureTestsTotal}`,
  );
  text("verified-at", `Verified ${value.verification.verifiedAt}`);
  text("sequence", String(value.registrySequence));
  text("fresh-until", `Signed freshness ends ${value.expiresAt}`);
  text(
    "runtime",
    `${value.compatibility.runtime.minimum} – ${value.compatibility.runtime.maximumExclusive}`,
  );
  text(
    "bridge",
    `Bridge protocol ${value.compatibility.bridgeProtocol.minimum}–${value.compatibility.bridgeProtocol.maximum}`,
  );
  text("source-commit", `Source commit: ${value.verification.sourceCommit}`);
  const current = element("current-artifact");
  current.hidden = value.current === undefined;
  if (value.current !== undefined) {
    text(
      "current-version",
      `${value.current.version} · ${value.current.digest}`,
    );
  }
  install.textContent =
    value.kind === "rollback"
      ? "Activate verified rollback"
      : value.kind === "update"
        ? "Grant exact origins and update"
        : "Grant exact origins and install";
  element("freshness-warning").hidden = value.freshness !== "cached";
  replaceChildren(
    element("paths"),
    value.paths.map((path) => {
      const item = document.createElement("li");
      item.className = "list-row border-base-300 border";
      const content = document.createElement("div");
      content.className = "list-col-grow min-w-0";
      const origin = document.createElement("div");
      origin.className = "font-semibold break-all";
      origin.textContent = path.origin;
      const rules = document.createElement("div");
      rules.className = "text-base-content/70 font-mono text-xs break-all";
      rules.textContent = path.rules.join(", ");
      content.append(origin, rules);
      item.append(content);
      return item;
    }),
  );
  replaceChildren(
    element("tools"),
    value.tools.map((tool) => {
      const row = document.createElement("tr");
      row.append(
        cell(`${tool.name}\n${tool.title ?? tool.description}`),
        cell(tool.risk),
        cell(tool.permissions.join(", ")),
        cell(
          `input ${JSON.stringify(tool.inputSchema)}\noutput ${JSON.stringify(tool.outputSchema)}`,
        ),
      );
      return row;
    }),
  );
}

async function request<T>(message: unknown): Promise<CommunityPackResult<T>> {
  const response = (await chrome.runtime.sendMessage(
    message,
  )) as CommunityPackResult<T>;
  if (
    typeof response !== "object" ||
    response === null ||
    !("ok" in response)
  ) {
    return { ok: false, error: { code: "INVALID_MESSAGE" } };
  }
  return response;
}

function showFailure(code: string): void {
  review = undefined;
  status.textContent = `MCPatch refused this installation: ${code}.`;
  status.className = "alert alert-error";
  status.hidden = false;
  install.disabled = true;
  cancel.disabled = false;
}

function setDisabled(value: boolean): void {
  install.disabled = value;
  cancel.disabled = value;
}

function cell(value: string): HTMLTableCellElement {
  const result = document.createElement("td");
  result.className = "whitespace-pre-line break-all";
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
  if (value === null)
    throw new Error(`missing community review element: ${id}`);
  return value as T;
}
