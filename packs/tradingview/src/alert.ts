import {
  TRADINGVIEW_FINGERPRINT,
  TRADINGVIEW_PRICE_ALERTS_ORIGIN,
  TradingViewPackError,
  type TradingViewCreatePriceAlertInput,
  type TradingViewCreatePriceAlertResult,
  type TradingViewCurrentChartResult,
} from "./model.js";
import { isCanonicalTradingViewSymbol } from "./symbol.js";

const CREATE_PATH = "/create_alert";
const LIST_PATH = "/list_alerts";
const MAX_CREATE_RESPONSE_BYTES = 256 * 1024;
const MAX_LIST_RESPONSE_BYTES = 512 * 1024;
const MAX_ALERTS = 512;
const REQUEST_TIMEOUT_MS = 10_000;
const ALERT_ID = /^[A-Za-z0-9_-]{1,64}$/u;
const RESOLUTION = /^(?:[1-9][0-9]{0,3}|[DWM]|[1-9][0-9]?[DWM])$/u;

export type TradingViewAlertFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function createTradingViewPriceAlert(
  fetchRequest: TradingViewAlertFetch,
  chart: TradingViewCurrentChartResult,
  value: unknown,
  signal: AbortSignal,
  now: () => number = Date.now,
): Promise<TradingViewCreatePriceAlertResult> {
  abortIfNeeded(signal);
  if (typeof fetchRequest !== "function" || typeof now !== "function") {
    unavailable();
  }
  const input = validateTradingViewPriceAlertInput(value);
  const symbol = chart?.symbol;
  const resolution = chart?.interval;
  if (
    !isCanonicalTradingViewSymbol(symbol) ||
    typeof resolution !== "string" ||
    !RESOLUTION.test(resolution)
  ) {
    unavailable();
  }
  const currentTime = now();
  if (!Number.isSafeInteger(currentTime) || currentTime < 0) unavailable();
  const expiresAt = new Date(
    currentTime + input.expiresInDays * 86_400_000,
  ).toISOString();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchRequest(
      new URL(CREATE_PATH, TRADINGVIEW_PRICE_ALERTS_ORIGIN).href,
      {
        method: "POST",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify({
          payload: createPayload(symbol, resolution, expiresAt, input),
        }),
        signal: controller.signal,
      },
    );
    abortIfNeeded(signal);
    if (!response.ok || response.type === "opaqueredirect") unavailable();
    const decoded = await decodeBoundedJson(
      response,
      MAX_CREATE_RESPONSE_BYTES,
    );
    const alertId = parseCreatedAlertId(decoded);
    const confirmed = await confirmAlert(
      fetchRequest,
      alertId,
      symbol,
      controller.signal,
    );
    abortIfNeeded(signal);
    return Object.freeze({
      fingerprint: TRADINGVIEW_FINGERPRINT,
      state: confirmed ? "confirmed" : "created_unconfirmed",
      alertId,
      symbol,
      condition: input.condition,
      threshold: input.threshold,
      frequency: input.frequency,
      expiresAt,
      notification: input.notification,
    });
  } catch (error) {
    abortIfNeeded(signal);
    if (error instanceof TradingViewPackError) throw error;
    unavailable();
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export function validateTradingViewPriceAlertInput(
  value: unknown,
): TradingViewCreatePriceAlertInput {
  if (!isDataObject(value)) invalidArguments();
  const expected = [
    "condition",
    "expiresInDays",
    "frequency",
    "notification",
    "threshold",
  ];
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expected.length ||
    keys.some((key) => typeof key !== "string" || !expected.includes(key)) ||
    expected.some((key) => !Object.hasOwn(value, key))
  ) {
    invalidArguments();
  }
  const condition = dataValue(value, "condition");
  const threshold = dataValue(value, "threshold");
  const frequency = dataValue(value, "frequency");
  const expiresInDays = dataValue(value, "expiresInDays");
  const notification = dataValue(value, "notification");
  if (
    !isOneOf(condition, ["above", "below", "crosses"]) ||
    typeof threshold !== "number" ||
    !Number.isFinite(threshold) ||
    Math.abs(threshold) > 1_000_000_000_000 ||
    !isOneOf(frequency, ["once", "once_per_bar_close"]) ||
    !Number.isSafeInteger(expiresInDays) ||
    (expiresInDays as number) < 1 ||
    (expiresInDays as number) > 365 ||
    !isOneOf(notification, [
      "mobile_push",
      "popup_and_mobile_push",
      "popup_only",
    ])
  ) {
    invalidArguments();
  }
  return Object.freeze({
    condition,
    threshold,
    frequency,
    expiresInDays: expiresInDays as number,
    notification,
  });
}

function createPayload(
  symbol: string,
  resolution: string,
  expiresAt: string,
  input: TradingViewCreatePriceAlertInput,
): Record<string, unknown> {
  const condition = {
    above: "greater",
    below: "less",
    crosses: "cross",
  }[input.condition];
  const frequency = {
    once: "on_first_fire",
    once_per_bar_close: "on_bar_close",
  }[input.frequency];
  const popup = input.notification !== "mobile_push";
  const mobilePush = input.notification !== "popup_only";
  const ticker = symbol.slice(symbol.indexOf(":") + 1);
  const verb =
    input.condition === "above"
      ? "above"
      : input.condition === "below"
        ? "below"
        : "crossing";
  return {
    symbol: `=${JSON.stringify({ symbol })}`,
    resolution,
    message: `${ticker} ${verb} ${String(input.threshold)}`,
    sound_file: null,
    sound_duration: 0,
    popup,
    expiration: expiresAt,
    auto_deactivate: true,
    email: false,
    sms_over_email: false,
    mobile_push: mobilePush,
    web_hook: null,
    name: null,
    conditions: [
      {
        type: condition,
        frequency,
        series: [{ type: "barset" }, { type: "value", value: input.threshold }],
        resolution,
      },
    ],
    active: true,
    ignore_warnings: true,
  };
}

function parseCreatedAlertId(value: unknown): string {
  if (!isDataObject(value) || dataValue(value, "s") !== "ok") unavailable();
  const result = dataValue(value, "r");
  if (!isDataObject(result)) unavailable();
  return normalizeAlertId(dataValue(result, "alert_id"));
}

async function confirmAlert(
  fetchRequest: TradingViewAlertFetch,
  alertId: string,
  symbol: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetchRequest(
      new URL(LIST_PATH, TRADINGVIEW_PRICE_ALERTS_ORIGIN).href,
      {
        method: "GET",
        credentials: "include",
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      },
    );
    if (!response.ok || response.type === "opaqueredirect") return false;
    const decoded = await decodeBoundedJson(response, MAX_LIST_RESPONSE_BYTES);
    if (!isDataObject(decoded) || dataValue(decoded, "s") !== "ok")
      return false;
    const alerts = dataValue(decoded, "r");
    if (!Array.isArray(alerts) || alerts.length > MAX_ALERTS) return false;
    for (const alert of alerts) {
      if (!isDataObject(alert)) continue;
      let candidateId: string;
      try {
        candidateId = normalizeAlertId(dataValue(alert, "alert_id"));
      } catch {
        continue;
      }
      if (candidateId !== alertId) continue;
      return parseSymbolMarker(dataValue(alert, "symbol")) === symbol;
    }
    return false;
  } catch {
    return false;
  }
}

function parseSymbolMarker(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !value.startsWith("=")
  ) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(value.slice(1)) as unknown;
    if (!isDataObject(decoded)) return undefined;
    const symbol = dataValue(decoded, "symbol");
    return typeof symbol === "string" && isCanonicalTradingViewSymbol(symbol)
      ? symbol
      : undefined;
  } catch {
    return undefined;
  }
}

async function decodeBoundedJson(
  response: Response,
  maximum: number,
): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length"));
  if (
    !contentType.toLowerCase().startsWith("application/json") ||
    (Number.isFinite(contentLength) && contentLength > maximum)
  ) {
    unavailable();
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > maximum) unavailable();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    unavailable();
  }
}

function normalizeAlertId(value: unknown): string {
  const id =
    typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : value;
  if (typeof id !== "string" || !ALERT_ID.test(id)) unavailable();
  return id;
}

function isOneOf<const TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
): value is TValue {
  return typeof value === "string" && allowed.includes(value as TValue);
}

function dataValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && "value" in descriptor
    ? descriptor.value
    : undefined;
}

function isDataObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function invalidArguments(): never {
  throw new TradingViewPackError("EXECUTION_FAILED", "invalid_arguments");
}

function abortIfNeeded(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new TradingViewPackError("CANCELLED", "cancelled");
  }
}

function unavailable(): never {
  throw new TradingViewPackError(
    "EXECUTION_FAILED",
    "alert_creation_unavailable",
  );
}
