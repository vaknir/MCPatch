import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
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
  FIXTURE_ORIGIN,
  FIXTURE_STATE_TOOL,
  FIXTURE_WAIT_TOOL,
  OTHER_ORIGIN,
} from "./fixture-constants.js";
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
  const profile = testInfo.outputPath("chromium-profile");
  let context: BrowserContext | undefined;
  let mcp: McpStdioClient | undefined;

  try {
    await prepareNativeHostProfile(profile);
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: process.env["MCPATCH_BROWSER_HEADED"] !== "1",
      args: [
        `--disable-extensions-except=${extensionPath}`,
        "--host-resolver-rules=MAP * ~NOTFOUND",
        `--load-extension=${extensionPath}`,
      ],
    });
    await installNetworkBoundary(context, fixtureHtml, fixtureCss);
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

    const client = await McpStdioClient.connect(bridgePath);
    mcp = client;
    await expectTools(client, [demoTool]);

    const page = await context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/state`);
    await expectTools(client, [
      demoTool,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
    ]);
    expect(await callState(client)).toEqual({ revision: 1, value: "initial" });

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
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
    ]);

    await page.reload();
    await expectTools(client, [
      demoTool,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
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
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
    ]);
    await page.goto(`${OTHER_ORIGIN}/replacement`);
    await expectTools(client, [demoTool]);

    await page.goto(`${FIXTURE_ORIGIN}/state`);
    await expectTools(client, [
      demoTool,
      FIXTURE_STATE_TOOL,
      FIXTURE_WAIT_TOOL,
    ]);
    await disableFixture(control);
    await expectTools(client, [demoTool]);
    await expect.poll(() => registeredContentScriptCount(worker)).toBe(0);
  } finally {
    await mcp?.close();
    await context?.close();
    await rm(profile, { recursive: true, force: true });
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
): Promise<void> {
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "chrome-extension:") {
      await route.continue();
      return;
    }
    if (url.origin !== FIXTURE_ORIGIN && url.origin !== OTHER_ORIGIN) {
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
