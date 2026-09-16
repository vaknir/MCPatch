import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

import { McpStdioClient, structuredContent } from "./mcp-client.js";

const extensionPath = fileURLToPath(
  new URL("../../../apps/extension/dist/", import.meta.url),
);
const bridgePath = fileURLToPath(
  new URL("../../../target/debug/mcpatch", import.meta.url),
);
const extensionId = "imbnpameklobbabbkfkalcfcggpjacdi";
const chartUrl = "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL";
const unsupportedUrl = "https://www.tradingview.com/markets/";
const demoTool = "mcpatch.demo.status";
const currentChartTool = "tradingview.current_chart";
const currentWatchlistTool = "tradingview.current_watchlist";
const changeSymbolTool = "tradingview.change_symbol";
const fingerprint = "tradingview-chart-semantic-en-v1";
const tradingViewTools = [
  changeSymbolTool,
  currentChartTool,
  currentWatchlistTool,
] as const;

test.describe.configure({ mode: "serial" });
test.skip(
  process.env["MCPATCH_TRADINGVIEW_FIELD_SMOKE"] !== "1",
  "TradingView field smoke is explicit and never runs in routine CI",
);
test.skip(
  process.env["MCPATCH_BROWSER_HEADED"] !== "1",
  "optional host permission requires a visible user gesture",
);
test.skip(
  process.platform === "win32",
  "temporary-profile Native Messaging registration is Unix-only",
);

test("invokes TradingView read tools through MCP in a disposable signed-out profile", async ({
  browserName,
}, testInfo) => {
  if (browserName !== "chromium") {
    throw new Error("TradingView field smoke requires Chromium");
  }
  test.setTimeout(300_000);
  const profile = testInfo.outputPath("tradingview-profile");
  let context: BrowserContext | undefined;
  let mcp: McpStdioClient | undefined;

  try {
    await prepareNativeHostProfile(profile);
    context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const worker =
      context.serviceWorkers()[0] ??
      (await context.waitForEvent("serviceworker"));
    if (new URL(worker.url()).host !== extensionId) {
      throw new Error("unexpected extension identity");
    }

    const page = await context.newPage();
    await page.goto(chartUrl, { waitUntil: "domcontentloaded" });
    const client = await McpStdioClient.connect(bridgePath);
    mcp = client;
    await waitForTools(client, [demoTool]);

    fieldInstruction(
      "ENABLE_REQUIRED",
      "Click the MCPatch toolbar action for this tab and approve the exact tradingview.com permission.",
    );
    await waitFor(
      () => registeredContentScriptCount(worker),
      (count) => count === 1,
      120_000,
      "TradingView content-script registration did not appear",
    );
    await waitFor(
      () => activeTabActionTitle(worker),
      (title) => title === "Disable TradingView",
      10_000,
      "TradingView enablement did not become authoritative",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    try {
      await waitForTools(client, [demoTool, ...tradingViewTools], 60_000);
    } catch (error) {
      throw new Error(
        `TradingView pack did not activate: ${JSON.stringify(
          await readActivationDiagnostic(worker, page),
        )}`,
        { cause: error },
      );
    }

    validateCurrentChart(
      structuredContent(await client.callTool(currentChartTool).response),
      "NASDAQ:AAPL",
    );
    validateCurrentWatchlist(
      structuredContent(await client.callTool(currentWatchlistTool).response),
    );

    await page.goto(unsupportedUrl, { waitUntil: "domcontentloaded" });
    await waitForTools(client, [demoTool], 30_000);

    fieldInstruction(
      "PASS",
      JSON.stringify({
        browser: context.browser()?.version() ?? "unknown",
        fingerprint,
        tools: tradingViewTools,
      }),
    );
  } finally {
    await mcp?.close();
    await context?.close();
    await rm(profile, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
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

function validateCurrentChart(value: unknown, expectedSymbol: string): void {
  const chart = dataObject(value);
  if (
    chart?.["fingerprint"] !== fingerprint ||
    chart["symbol"] !== expectedSymbol ||
    typeof chart["name"] !== "string" ||
    chart["name"].length < 1 ||
    chart["name"].length > 128 ||
    typeof chart["interval"] !== "string" ||
    chart["interval"].length < 1 ||
    chart["interval"].length > 32
  ) {
    throw new Error("TradingView current-chart identity contract changed");
  }
  for (const key of ["open", "high", "low", "close", "price"]) {
    const number = chart[key];
    if (typeof number !== "number" || !Number.isFinite(number)) {
      throw new Error("TradingView current-chart numeric contract changed");
    }
  }
}

function validateCurrentWatchlist(value: unknown): void {
  const watchlist = dataObject(value);
  const items = watchlist?.["items"];
  if (
    watchlist?.["fingerprint"] !== fingerprint ||
    !Array.isArray(items) ||
    items.length < 1 ||
    items.length > 64
  ) {
    throw new Error("TradingView watchlist bounds changed");
  }
  for (const value of items) {
    const item = dataObject(value);
    if (
      typeof item?.["symbol"] !== "string" ||
      !/^[A-Z0-9_]{1,24}:[A-Z0-9][A-Z0-9._!-]{0,31}$/u.test(item["symbol"]) ||
      typeof item["price"] !== "number" ||
      !Number.isFinite(item["price"]) ||
      typeof item["change"] !== "number" ||
      !Number.isFinite(item["change"]) ||
      typeof item["changePercent"] !== "number" ||
      !Number.isFinite(item["changePercent"])
    ) {
      throw new Error("TradingView watchlist item contract changed");
    }
  }
}

async function waitForTools(
  client: McpStdioClient,
  expected: readonly string[],
  timeoutMs = 10_000,
): Promise<void> {
  const sorted = [...expected].sort();
  let observed: readonly string[] = [];
  try {
    await waitFor(
      async () => {
        observed = toolNames(await client.listTools());
        return observed;
      },
      (names) =>
        names.length === sorted.length &&
        names.every((name, index) => name === sorted[index]),
      timeoutMs,
      "MCP tool discovery did not reach the expected exact set",
    );
  } catch (error) {
    throw new Error(
      `MCP tool discovery expected ${sorted.join(",")} but observed ${observed.join(",") || "none"}`,
      { cause: error },
    );
  }
}

function toolNames(tools: readonly unknown[]): readonly string[] {
  return tools
    .map((tool) => {
      const object = dataObject(tool);
      if (typeof object?.["name"] !== "string") {
        throw new Error("MCP returned a malformed tool descriptor");
      }
      return object["name"];
    })
    .sort();
}

async function registeredContentScriptCount(worker: Worker): Promise<number> {
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

async function activeTabActionTitle(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      chrome: {
        action: {
          getTitle(details: { readonly tabId: number }): Promise<string>;
        };
        tabs: {
          query(details: {
            readonly active: boolean;
            readonly currentWindow: boolean;
          }): Promise<readonly { readonly id?: number }[]>;
        };
      };
    };
    const tab = (
      await scope.chrome.tabs.query({ active: true, currentWindow: true })
    )[0];
    if (tab?.id === undefined) return "";
    return scope.chrome.action.getTitle({ tabId: tab.id });
  });
}

async function readActivationDiagnostic(
  worker: Worker,
  page: Page,
): Promise<unknown> {
  const browser = await worker.evaluate(async () => {
    const scope = globalThis as typeof globalThis & {
      chrome: {
        permissions: {
          contains(details: { origins: string[] }): Promise<boolean>;
        };
        scripting: {
          getRegisteredContentScripts(): Promise<
            readonly { id: string; matches?: readonly string[] }[]
          >;
        };
      };
    };
    return {
      permission: await scope.chrome.permissions.contains({
        origins: ["https://www.tradingview.com/*"],
      }),
      registrations: await scope.chrome.scripting.getRegisteredContentScripts(),
    };
  });
  const pageState = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    pathname: location.pathname,
    readyState: document.readyState,
    chartRegions: document.querySelectorAll(
      '[role="region"][aria-label^="Chart #"]',
    ).length,
    watchlists: document.querySelectorAll('[data-name="symbol-list-wrap"]')
      .length,
  }));
  return { browser, document: pageState };
}

async function waitFor<T>(
  read: () => T | Promise<T>,
  accept: (value: T) => boolean,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await read();
      if (accept(value)) return value;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(timeoutMessage);
}

function dataObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function fieldInstruction(state: string, message: string): void {
  process.stdout.write(
    `\nMCPATCH_TRADINGVIEW_FIELD_SMOKE ${state}: ${message}\n`,
  );
}
