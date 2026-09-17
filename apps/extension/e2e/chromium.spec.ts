import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import {
  COMMUNITY_ORIGIN,
  COMMUNITY_REGISTRY_ORIGIN,
  COMMUNITY_TOOL,
  FIXTURE_LOCAL_TOOL,
  FIXTURE_ORIGIN,
  FIXTURE_PROBE_TOOL,
  FIXTURE_STATE_TOOL,
  FIXTURE_WAIT_TOOL,
  OTHER_ORIGIN,
} from "./fixture-constants.js";
import { communityRegistryFixture } from "./fixture-community-registry.js";
import { McpStdioClient, structuredContent } from "./mcp-client.js";

const extensionPath = fileURLToPath(
  new URL("../../../.artifacts/chromium-fixture-extension/", import.meta.url),
);
const bridgePath = fileURLToPath(
  new URL("../../../target/debug/mcpatch", import.meta.url),
);
const fixtureHtmlPath = fileURLToPath(
  new URL("fixtures/site.html", import.meta.url),
);
const fixtureCssPath = fileURLToPath(
  new URL(
    "../../../.artifacts/chromium-fixture-extension/fixture.css",
    import.meta.url,
  ),
);
const extensionId = "imbnpameklobbabbkfkalcfcggpjacdi";
const demoTool = "mcpatch.demo.status";

test.describe.configure({ mode: "serial" });
test.skip(
  process.platform === "win32",
  "temporary-profile Native Messaging registration is Unix-only",
);

test("routes and revokes a synthetic page through real Chromium and MCP", async ({
  browserName,
}, testInfo) => {
  expect(browserName).toBe("chromium");
  const fixtureHtml = await readFile(fixtureHtmlPath, "utf8");
  const fixtureCss = await readFile(fixtureCssPath, "utf8");
  const registry = await communityRegistryFixture();
  const registryRequests: string[] = [];
  const profile = testInfo.outputPath("chromium-profile");
  let runtimeDirectory: string | undefined;
  let context: BrowserContext | undefined;
  let mcp: McpStdioClient | undefined;

  try {
    runtimeDirectory = await mkdtemp(join(tmpdir(), "mcpatch-e2e-"));
    await prepareNativeHostProfile(profile);
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: process.env["MCPATCH_BROWSER_HEADED"] !== "1",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        "--host-resolver-rules=MAP * ~NOTFOUND",
        `--load-extension=${extensionPath}`,
      ],
      env: { ...process.env, MCPATCH_RUNTIME_DIR: runtimeDirectory },
    });
    await installNetworkBoundary(
      context,
      fixtureHtml,
      fixtureCss,
      registry,
      registryRequests,
    );
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    expect(new URL(worker.url()).host).toBe(extensionId);
    await testInfo.attach("browser-environment.json", {
      body: Buffer.from(
        `${JSON.stringify(
          {
            browser: context.browser()?.version() ?? "unknown",
            extensionId,
            platform: process.platform,
            playwright: "1.63.0",
          },
          null,
          2,
        )}\n`,
      ),
      contentType: "application/json",
    });

    const control = await context.newPage();
    const controlErrors: string[] = [];
    control.on("pageerror", (error) => controlErrors.push(error.message));
    await control.goto(
      `chrome-extension://${extensionId}/fixture-control.html`,
    );
    await expect
      .poll(async () => ({
        errors: controlErrors,
        state: await control
          .locator("#fixture-status")
          .getAttribute("data-state"),
      }))
      .toEqual({ errors: [], state: "disabled" });
    await control.locator("#fixture-enable").click();
    await expect(control.locator("#fixture-status")).toHaveAttribute(
      "data-state",
      "enabled",
    );
    await expect.poll(() => registeredContentScriptCount(worker)).toBe(1);

    const client = await McpStdioClient.connect(bridgePath, [], {
      MCPATCH_RUNTIME_DIR: runtimeDirectory,
    });
    mcp = client;
    await expectTools(client, [demoTool]);

    const page = await context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/state`);
    await expect
      .poll(() => page.locator("html").getAttribute("data-fixture-runtime"))
      .toBe("ready");
    await expectTools(client, [
      demoTool,
      FIXTURE_LOCAL_TOOL,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
      FIXTURE_PROBE_TOOL,
    ]);
    expect(await callState(client)).toEqual({ revision: 1, value: "initial" });
    expect(
      structuredContent(await client.callTool(FIXTURE_LOCAL_TOOL).response),
    ).toMatchObject({
      text: expect.stringContaining("Synthetic website state"),
    });

    // The realm lockdown installed before pack code ran must refuse every
    // network primitive from inside a pack handler, while the credential-free
    // DOM read above still works.
    expect(
      structuredContent(await client.callTool(FIXTURE_PROBE_TOOL).response),
    ).toEqual({
      fetchUndeclaredBlocked: true,
      fetchHttpBlocked: true,
      xhrBlocked: true,
      sendBeaconBlocked: true,
      cookieBlocked: true,
    });

    await page.locator("#fixture-update").click();
    await expect
      .poll(() => callState(client))
      .toEqual({ revision: 2, value: "updated" });

    const waiting = client.callTool(FIXTURE_WAIT_TOOL);
    await expect(page.locator("html")).toHaveAttribute(
      "data-fixture-wait",
      "running",
    );
    client.cancel(waiting.id);
    await waiting.response;
    await expect(page.locator("html")).toHaveAttribute(
      "data-fixture-wait",
      "cancelled",
    );
    await expectTools(client, [
      demoTool,
      FIXTURE_LOCAL_TOOL,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
      FIXTURE_PROBE_TOOL,
    ]);

    await page.reload();
    await expectTools(client, [
      demoTool,
      FIXTURE_LOCAL_TOOL,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
      FIXTURE_PROBE_TOOL,
    ]);
    expect(await callState(client)).toEqual({ revision: 1, value: "initial" });

    await page.goto(`${FIXTURE_ORIGIN}/malformed`);
    await expectTools(client, [demoTool]);
    expect(structuredContent(await client.callTool(demoTool).response)).toEqual(
      { status: "ready" },
    );

    await page.goto(`${FIXTURE_ORIGIN}/state`);
    await expectTools(client, [
      demoTool,
      FIXTURE_LOCAL_TOOL,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
      FIXTURE_PROBE_TOOL,
    ]);
    await page.goto(`${OTHER_ORIGIN}/replacement`);
    await expectTools(client, [demoTool]);

    await page.goto(`${FIXTURE_ORIGIN}/state`);
    await expectTools(client, [
      demoTool,
      FIXTURE_LOCAL_TOOL,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
      FIXTURE_PROBE_TOOL,
    ]);
    await disableFixture(control);
    await expectTools(client, [demoTool]);
    await expect.poll(() => registeredContentScriptCount(worker)).toBe(0);

    const communityPage = await context.newPage();
    await communityPage.goto(`${COMMUNITY_ORIGIN}/portfolio`);
    await communityPage.bringToFront();
    const communityTabId = await activeTabId(worker);
    await triggerCommunityDiscovery(
      worker,
      communityTabId,
      `${COMMUNITY_ORIGIN}/portfolio`,
    );
    await expect
      .poll(() => communityCandidateStatus(worker))
      .toEqual({ candidate: true, installed: 0, sequence: 1 });
    await expect
      .poll(
        () =>
          (context?.pages() ?? []).some((candidate) =>
            candidate
              .url()
              .startsWith(
                `chrome-extension://${extensionId}/community-review.html`,
              ),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    const review = context
      .pages()
      .find((candidate) =>
        candidate
          .url()
          .startsWith(
            `chrome-extension://${extensionId}/community-review.html`,
          ),
      );
    if (review === undefined) throw new Error("community review page missing");
    await review.waitForLoadState("domcontentloaded");
    await expect(review.locator("#trust")).toHaveText("REVIEWED_COMMUNITY");
    await expect(review.locator("#identity")).toHaveText(
      "community/visible-page",
    );
    await expect(review.locator("#paths")).toContainText(COMMUNITY_ORIGIN);
    await expect(review.locator("#tools")).toContainText(COMMUNITY_TOOL);
    await review.locator("#install").click();
    await expect(review.locator("#status")).toHaveText(
      "The verified pack is installed and enabled.",
    );
    await expect.poll(() => registeredContentScriptCount(worker)).toBe(1);

    await communityPage.reload();
    await expect
      .poll(() =>
        communityPage.locator("html").getAttribute("data-fixture-runtime"),
      )
      .toBe("ready");
    await expectTools(client, [demoTool, COMMUNITY_TOOL]);
    expect(
      structuredContent(await client.callTool(COMMUNITY_TOOL).response),
    ).toMatchObject({
      text: expect.stringContaining("Synthetic website state"),
    });
    expect(registryRequests).toEqual(["/v1/index.json", registry.bundlePath]);
  } finally {
    await mcp?.close();
    await context?.close();
    await rm(profile, { recursive: true, force: true });
    if (runtimeDirectory !== undefined) {
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
  }
});

async function prepareNativeHostProfile(profile: string): Promise<void> {
  const directory = join(profile, "NativeMessagingHosts");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "dev.mcpatch.bridge.json"),
    `${JSON.stringify(
      {
        name: "dev.mcpatch.bridge",
        description: "MCPatch local capability bridge",
        path: await realpath(bridgePath),
        type: "stdio",
        allowed_origins: [`chrome-extension://${extensionId}/`],
      },
      null,
      2,
    )}\n`,
    { flag: "wx", mode: 0o600 },
  );
}

async function installNetworkBoundary(
  context: BrowserContext,
  fixtureHtml: string,
  fixtureCss: string,
  registry: {
    readonly bundleBytes: Uint8Array;
    readonly bundlePath: string;
    readonly indexBytes: Uint8Array;
  },
  registryRequests: string[],
): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:") {
      await route.continue();
      return;
    }
    if (url.origin === COMMUNITY_REGISTRY_ORIGIN) {
      const body =
        url.pathname === "/v1/index.json"
          ? registry.indexBytes
          : url.pathname === registry.bundlePath
            ? registry.bundleBytes
            : undefined;
      if (body === undefined) {
        await route.abort("blockedbyclient");
        return;
      }
      registryRequests.push(url.pathname);
      await route.fulfill({
        body: Buffer.from(body),
        contentType:
          url.pathname === "/v1/index.json"
            ? "application/vnd.mcpatch.registry-index+json"
            : "application/vnd.mcpatch.pack+json",
        headers: {
          "content-length": String(body.byteLength),
          "x-content-type-options": "nosniff",
        },
        status: 200,
      });
      return;
    }
    if (
      url.origin !== FIXTURE_ORIGIN &&
      url.origin !== OTHER_ORIGIN &&
      url.origin !== COMMUNITY_ORIGIN
    ) {
      await route.abort("blockedbyclient");
      return;
    }
    if (url.pathname === "/fixture.css") {
      await route.fulfill({
        body: fixtureCss,
        contentType: "text/css; charset=utf-8",
        status: 200,
      });
      return;
    }
    await route.fulfill({
      body: fixtureHtml,
      contentType: "text/html; charset=utf-8",
      headers: {
        "content-security-policy":
          "default-src 'none'; style-src 'self'; script-src 'unsafe-inline'",
      },
      status: 200,
    });
  });
}

async function activeTabId(worker: {
  evaluate<Result>(
    pageFunction: () => Result | Promise<Result>,
  ): Promise<Result>;
}): Promise<number> {
  return worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      chrome: {
        tabs: {
          query(value: {
            readonly active: true;
            readonly currentWindow: true;
          }): Promise<readonly { readonly id?: number }[]>;
        };
      };
    };
    const tabs = await scope.chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    const id = tabs[0]?.id;
    if (typeof id !== "number") throw new Error("active fixture tab missing");
    return id;
  });
}

async function triggerCommunityDiscovery(
  worker: {
    evaluate<Argument, Result>(
      pageFunction: (argument: Argument) => Result | Promise<Result>,
      argument: Argument,
    ): Promise<Result>;
  },
  tabId: number,
  url: string,
): Promise<void> {
  await worker.evaluate(
    (tab) => {
      const discover = (
        globalThis as typeof globalThis & {
          __MCPATCH_FIXTURE_DISCOVER__?: (value: {
            readonly id: number;
            readonly url: string;
          }) => void;
        }
      ).__MCPATCH_FIXTURE_DISCOVER__;
      if (discover === undefined)
        throw new Error("fixture discovery seam missing");
      discover(tab);
    },
    { id: tabId, url },
  );
}

async function communityCandidateStatus(worker: {
  evaluate<Result>(
    pageFunction: () => Result | Promise<Result>,
  ): Promise<Result>;
}): Promise<{
  readonly candidate: boolean;
  readonly installed: number;
  readonly sequence: number;
}> {
  return worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      chrome: {
        storage: {
          local: {
            get(key: string): Promise<Record<string, unknown>>;
          };
        };
      };
    };
    const key = "mcpatch.community-packs.v1";
    const stored = await scope.chrome.storage.local.get(key);
    const state = stored[key] as
      | {
          readonly candidate?: unknown;
          readonly highWaterSequence?: unknown;
          readonly installed?: readonly unknown[];
        }
      | undefined;
    return {
      candidate: state?.candidate !== undefined,
      installed: Array.isArray(state?.installed) ? state.installed.length : -1,
      sequence:
        typeof state?.highWaterSequence === "number"
          ? state.highWaterSequence
          : -1,
    };
  });
}

async function expectTools(
  client: McpStdioClient,
  names: readonly string[],
): Promise<void> {
  await expect
    .poll(async () => toolNames(await client.listTools()), { timeout: 10_000 })
    .toEqual([...names].sort());
}

function toolNames(tools: readonly unknown[]): readonly string[] {
  return tools
    .map((tool) => {
      if (typeof tool !== "object" || tool === null || Array.isArray(tool)) {
        throw new Error("MCP returned a malformed tool");
      }
      const name = (tool as Record<string, unknown>)["name"];
      if (typeof name !== "string") throw new Error("MCP tool has no name");
      return name;
    })
    .sort();
}

async function callState(client: McpStdioClient): Promise<unknown> {
  return structuredContent(await client.callTool(FIXTURE_STATE_TOOL).response);
}

async function registeredContentScriptCount(worker: {
  evaluate<Result>(
    pageFunction: () => Result | Promise<Result>,
  ): Promise<Result>;
}): Promise<number> {
  return worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      chrome: {
        scripting: {
          getRegisteredContentScripts(): Promise<readonly unknown[]>;
        };
      };
    };
    return (await scope.chrome.scripting.getRegisteredContentScripts()).length;
  });
}

async function disableFixture(control: Page): Promise<void> {
  await control.bringToFront();
  await control.locator("#fixture-disable").click();
  await expect(control.locator("#fixture-status")).toHaveAttribute(
    "data-state",
    "disabled",
  );
}
