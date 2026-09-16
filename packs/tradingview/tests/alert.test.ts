import { describe, expect, it, vi } from "vitest";

import {
  createTradingViewSite,
  createTradingViewPriceAlert,
  validateTradingViewPriceAlertInput,
  type TradingViewCurrentChartResult,
  type TradingViewSemanticSnapshot,
} from "../src/index.js";

describe("TradingView price-alert session action", () => {
  it("creates one closed alert payload and confirms its ID and symbol", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json({ s: "ok", r: { alert_id: 456 } }))
      .mockResolvedValueOnce(
        json({
          s: "ok",
          r: [
            {
              alert_id: 456,
              symbol: '={"symbol":"NASDAQ:AAPL"}',
            },
          ],
        }),
      );

    await expect(
      createTradingViewPriceAlert(
        fetchRequest,
        chart(),
        input(),
        new AbortController().signal,
        () => Date.UTC(2026, 8, 16, 9, 0, 0),
      ),
    ).resolves.toEqual({
      fingerprint: "tradingview-chart-semantic-en-v1",
      state: "confirmed",
      alertId: "456",
      symbol: "NASDAQ:AAPL",
      condition: "above",
      threshold: 250.5,
      frequency: "once",
      expiresAt: "2026-10-16T09:00:00.000Z",
      notification: "popup_and_mobile_push",
    });

    const createCall = fetchRequest.mock.calls[0] as [string, RequestInit];
    expect(createCall[0]).toBe(
      "https://pricealerts.tradingview.com/create_alert",
    );
    expect(createCall[1]).toMatchObject({
      method: "POST",
      credentials: "include",
      redirect: "error",
      cache: "no-store",
    });
    expect(createCall[1].headers).toBeUndefined();
    expect(JSON.parse(String(createCall[1].body))).toEqual({
      payload: {
        symbol: '={"symbol":"NASDAQ:AAPL"}',
        resolution: "1D",
        message: "AAPL above 250.5",
        sound_file: null,
        sound_duration: 0,
        popup: true,
        expiration: "2026-10-16T09:00:00.000Z",
        auto_deactivate: true,
        email: false,
        sms_over_email: false,
        mobile_push: true,
        web_hook: null,
        name: null,
        conditions: [
          {
            type: "greater",
            frequency: "on_first_fire",
            series: [{ type: "barset" }, { type: "value", value: 250.5 }],
            resolution: "1D",
          },
        ],
        active: true,
        ignore_warnings: true,
      },
    });
    expect(fetchRequest).toHaveBeenNthCalledWith(
      2,
      "https://pricealerts.tradingview.com/list_alerts",
      expect.objectContaining({ method: "GET", credentials: "include" }),
    );
  });

  it("reports a created alert as unconfirmed instead of risking a duplicate retry", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json({ s: "ok", r: { alert_id: "abc_123" } }))
      .mockRejectedValueOnce(new Error("confirmation unavailable"));

    await expect(
      createTradingViewPriceAlert(
        fetchRequest,
        chart(),
        input(),
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      state: "created_unconfirmed",
      alertId: "abc_123",
    });
    expect(fetchRequest).toHaveBeenCalledTimes(2);
  });

  it("maps recurring bar-close and popup-only choices without hidden channels", async () => {
    const fetchRequest = vi
      .fn()
      .mockResolvedValueOnce(json({ s: "ok", r: { alert_id: 789 } }))
      .mockResolvedValueOnce(
        json({
          s: "ok",
          r: [{ alert_id: 789, symbol: '={"symbol":"NASDAQ:AAPL"}' }],
        }),
      );
    await createTradingViewPriceAlert(
      fetchRequest,
      chart(),
      {
        ...input(),
        condition: "below",
        frequency: "once_per_bar_close",
        notification: "popup_only",
      },
      new AbortController().signal,
    );

    const call = fetchRequest.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(call[1].body)) as {
      payload: Record<string, unknown> & {
        conditions: Array<Record<string, unknown>>;
      };
    };
    expect(body.payload.conditions[0]).toMatchObject({
      type: "less",
      frequency: "on_bar_close",
    });
    expect(body.payload).toMatchObject({
      popup: true,
      mobile_push: false,
      email: false,
      sms_over_email: false,
      web_hook: null,
    });
  });

  it("fails closed when creation is rejected or the response is malformed", async () => {
    for (const response of [
      json({ s: "error", errmsg: "invalid_request" }),
      json({ s: "ok", r: {} }),
      new Response("denied", { status: 403 }),
    ]) {
      const fetchRequest = vi.fn().mockResolvedValue(response);
      await expect(
        createTradingViewPriceAlert(
          fetchRequest,
          chart(),
          input(),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ reason: "alert_creation_unavailable" });
      expect(fetchRequest).toHaveBeenCalledTimes(1);
    }
  });

  it("requires every consequential field and rejects generic request authority", () => {
    expect(validateTradingViewPriceAlertInput(input())).toEqual(input());
    for (const value of [
      { ...input(), webhook: "https://example.com" },
      { ...input(), threshold: Number.POSITIVE_INFINITY },
      { ...input(), frequency: "every_tick" },
      { ...input(), expiresInDays: 366 },
      { ...input(), notification: "email" },
    ]) {
      expect(() => validateTradingViewPriceAlertInput(value)).toThrowError(
        expect.objectContaining({ reason: "invalid_arguments" }),
      );
    }
  });

  it("cancels before sending and rejects an incompatible chart identity", async () => {
    const fetchRequest = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createTradingViewPriceAlert(
        fetchRequest,
        chart(),
        input(),
        controller.signal,
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      createTradingViewPriceAlert(
        fetchRequest,
        { ...chart(), interval: "banana" },
        input(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ reason: "alert_creation_unavailable" });
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("permits only one creation attempt in a document lifecycle", async () => {
    const createPriceAlert = vi.fn().mockResolvedValue({
      fingerprint: "tradingview-chart-semantic-en-v1",
      state: "confirmed",
      alertId: "456",
      symbol: "NASDAQ:AAPL",
      condition: "above",
      threshold: 250.5,
      frequency: "once",
      expiresAt: "2026-10-16T09:00:00.000Z",
      notification: "popup_and_mobile_push",
    });
    const site = createTradingViewSite({
      read: semanticSnapshot,
      createPriceAlert,
    });
    const signal = new AbortController().signal;

    await expect(site.createPriceAlert(input(), signal)).resolves.toMatchObject(
      {
        state: "confirmed",
      },
    );
    await expect(site.createPriceAlert(input(), signal)).rejects.toMatchObject({
      reason: "alert_creation_already_started",
    });
    expect(createPriceAlert).toHaveBeenCalledTimes(1);
  });
});

function input() {
  return {
    condition: "above" as const,
    threshold: 250.5,
    frequency: "once" as const,
    expiresInDays: 30,
    notification: "popup_and_mobile_push" as const,
  };
}

function chart(): TradingViewCurrentChartResult {
  return {
    fingerprint: "tradingview-chart-semantic-en-v1",
    symbol: "NASDAQ:AAPL",
    ticker: "AAPL",
    exchange: "NASDAQ",
    name: "Apple Inc",
    interval: "1D",
    open: 249,
    high: 251,
    low: 248,
    close: 250,
    price: 250,
  };
}

function semanticSnapshot(): TradingViewSemanticSnapshot {
  return {
    origin: "https://www.tradingview.com",
    pathname: "/chart/",
    language: "en",
    documentTitle: "AAPL 250.00 current chart",
    symbolParameter: "NASDAQ:AAPL",
    charts: [
      {
        names: ["Apple Inc"],
        intervals: ["1D"],
        exchanges: ["NASDAQ"],
        canvasLabels: ["Chart for BATS:AAPL, 1 day"],
        ohlc: ["O249", "H251", "L248", "C250"],
        changes: ["1 (0.4%)"],
        volumes: ["1 M"],
        currencies: ["USD"],
      },
    ],
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
