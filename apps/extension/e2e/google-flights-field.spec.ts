import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  test,
  type BrowserContext,
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
const landingUrl = "https://www.google.com/travel/flights?hl=en";
const unsupportedUrl = "https://www.google.com/maps?hl=en";
const demoTool = "mcpatch.demo.status";
const currentSearchTool = "flights.current_search";
const resultsTool = "flights.results";
const priceInsightsTool = "flights.price_insights";
const fingerprint = "google-flights-rendered-en-v1";
const googleTools = [
  currentSearchTool,
  priceInsightsTool,
  resultsTool,
] as const;

test.describe.configure({ mode: "serial" });
test.skip(
  process.env["MCPATCH_REAL_SITE_SMOKE"] !== "1",
  "real-site smoke is explicit and never runs in routine CI",
);
test.skip(
  process.env["MCPATCH_BROWSER_HEADED"] !== "1",
  "optional host permission requires a visible user gesture",
);
test.skip(
  process.platform === "win32",
  "temporary-profile Native Messaging registration is Unix-only",
);

test("routes a signed-out Google Flights search without retaining page data", async ({
  browserName,
}, testInfo) => {
  if (browserName !== "chromium") {
    throw new Error("Google Flights field smoke requires Chromium");
  }
  test.setTimeout(300_000);
  const profile = testInfo.outputPath("google-flights-profile");
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
    await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
    const client = await McpStdioClient.connect(bridgePath);
    mcp = client;
    await waitForTools(client, [demoTool]);

    fieldInstruction(
      "ENABLE_REQUIRED",
      "Click the MCPatch toolbar action for this tab and approve the exact google.com permission.",
    );
    await waitFor(
      () => registeredContentScriptCount(worker),
      (count) => count === 1,
      120_000,
      "Google Flights content-script registration did not appear",
    );
    await waitFor(
      () => activeTabActionTitle(worker),
      (title) => title === "Disable Google Flights",
      10_000,
      "Google Flights enablement did not become authoritative",
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitForTools(client, [demoTool, currentSearchTool], 30_000);

    validateCurrentSearch(
      structuredContent(await client.callTool(currentSearchTool).response),
      "landing",
      false,
    );

    fieldInstruction(
      "SEARCH_REQUIRED",
      "Create a signed-out round-trip London to Paris search using future dates at least 30 days away, then click Search. Do not select a flight.",
    );
    await waitFor(
      () => new URL(page.url()).pathname,
      (path) => path === "/travel/flights/search",
      120_000,
      "Google Flights did not enter the supported search path",
    );
    await waitForTools(client, [demoTool, ...googleTools], 60_000);

    validateCurrentSearch(
      structuredContent(await client.callTool(currentSearchTool).response),
      "search",
      true,
    );
    await waitForReadyResults(client);
    validatePriceInsights(
      structuredContent(await client.callTool(priceInsightsTool).response),
    );

    await page.goto(unsupportedUrl, { waitUntil: "domcontentloaded" });
    await waitForTools(client, [demoTool], 30_000);

    await page.goto(landingUrl, { waitUntil: "domcontentloaded" });
    await waitForTools(client, [demoTool, currentSearchTool], 30_000);

    fieldInstruction(
      "DISABLE_REQUIRED",
      "Click the MCPatch toolbar action for this tab to disable the Google Flights pack.",
    );
    await waitFor(
      () => registeredContentScriptCount(worker),
      (count) => count === 0,
      120_000,
      "Google Flights content-script registration was not revoked",
    );
    await waitForTools(client, [demoTool], 30_000);

    fieldInstruction(
      "PASS",
      JSON.stringify({
        browser: context.browser()?.version() ?? "unknown",
        locale: await page.evaluate(() => document.documentElement.lang),
        tools: googleTools,
        fingerprint,
      }),
    );
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

async function waitForReadyResults(client: McpStdioClient): Promise<void> {
  await waitFor(
    async () => structuredContent(await client.callTool(resultsTool).response),
    (value) => {
      const result = dataObject(value);
      if (result?.["fingerprint"] !== fingerprint) {
        throw new Error("results compatibility fingerprint changed");
      }
      if (result["state"] === "loading") return false;
      if (result["state"] !== "ready") {
        throw new Error("Google Flights did not produce a ready result state");
      }
      const count = result["reportedCount"];
      const offers = result["offers"];
      if (
        typeof count !== "number" ||
        !Number.isSafeInteger(count) ||
        count < 1 ||
        !Array.isArray(offers) ||
        offers.length < 1 ||
        offers.length > 20
      ) {
        throw new Error("Google Flights result bounds were violated");
      }
      for (const offer of offers) validateOffer(offer);
      return true;
    },
    60_000,
    "Google Flights results did not become ready",
  );
}

function validateCurrentSearch(
  value: unknown,
  path: "landing" | "search",
  requireSearchValues: boolean,
): void {
  const current = dataObject(value);
  if (
    current?.["fingerprint"] !== fingerprint ||
    current["path"] !== path ||
    !["one_way", "round_trip"].includes(String(current["tripType"])) ||
    !["business", "economy", "first", "premium_economy"].includes(
      String(current["cabinClass"]),
    )
  ) {
    throw new Error("current-search contract or fingerprint changed");
  }
  for (const key of ["passengers", "origin", "destination", "departure"]) {
    const display = current[key];
    if (typeof display !== "string" || display.length > 256) {
      throw new Error("current-search display bounds were violated");
    }
    if (requireSearchValues && display.length === 0) {
      throw new Error("current-search omitted a required search value");
    }
  }
}

function validateOffer(value: unknown): void {
  const offer = dataObject(value);
  if (offer === undefined) throw new Error("flight offer was malformed");
  for (const key of [
    "summary",
    "price",
    "priceScope",
    "stops",
    "carrier",
    "departure",
    "arrival",
    "duration",
  ]) {
    const display = offer[key];
    if (typeof display !== "string" || display.length < 1) {
      throw new Error("flight offer omitted a required bounded display");
    }
  }
  if (!Array.isArray(offer["caveats"]) || offer["caveats"].length > 4) {
    throw new Error("flight offer caveat bounds were violated");
  }
}

function validatePriceInsights(value: unknown): void {
  const insight = dataObject(value);
  if (
    insight?.["fingerprint"] !== fingerprint ||
    !["available", "loading", "unavailable"].includes(String(insight["state"]))
  ) {
    throw new Error("price-insights contract or fingerprint changed");
  }
  if (
    insight["assessment"] !== undefined &&
    (typeof insight["assessment"] !== "string" ||
      insight["assessment"].length > 512)
  ) {
    throw new Error("price-insights display bounds were violated");
  }
}

async function waitForTools(
  client: McpStdioClient,
  expected: readonly string[],
  timeoutMs = 10_000,
): Promise<void> {
  const sorted = [...expected].sort();
  await waitFor(
    async () => toolNames(await client.listTools()),
    (names) =>
      names.length === sorted.length &&
      names.every((name, index) => name === sorted[index]),
    timeoutMs,
    "MCP tool discovery did not reach the expected exact set",
  );
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
  process.stdout.write(`\nMCPATCH_FIELD_SMOKE ${state}: ${message}\n`);
}
