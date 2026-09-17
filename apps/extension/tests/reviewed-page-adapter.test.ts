import type { JsonObject, JsonValue } from "@mcpatch/protocol";
import { BrowserToolExecutionError } from "@mcpatch/sdk/browser";
import { describe, expect, it, vi } from "vitest";

import type { PageCapability } from "../src/page-channel.js";
import type {
  PageAdapter,
  PageAdapterExecutionError,
} from "../src/page-content-model.js";
import {
  createReviewedDocumentAdapter,
  type ReviewedPageAdapterDefinition,
} from "../src/reviewed-page-adapter.js";
import {
  SITE_ORIGIN,
  SITE_TOOL,
  runtimeOptions,
  sitePack,
} from "./support/site-pack.js";

const OTHER_TOOL = "mcpatch.site.details";
const DOCUMENT = {} as Document;
const PACK_CAPABILITY: PageCapability = {
  source: "pack",
  name: SITE_TOOL,
};
const NATIVE_CAPABILITY: PageCapability = {
  source: "native_webmcp",
  name: SITE_TOOL,
  description: "Read native site status.",
  inputSchema: { type: "object", additionalProperties: false },
  annotations: {
    readOnlyHint: true,
    consequentialHint: false,
    untrustedContentHint: true,
  },
};

/** The captured navigation entry point a locked realm hands the adapter. */
const NAVIGATION = { assign: () => {} };

describe("reviewed page adapter", () => {
  it("constructs only an exact matching adapter after worker authorization", async () => {
    const pack = fakeAdapter([PACK_CAPABILITY], { source: "pack" });
    const factory = vi.fn(() => pack.adapter);
    const adapter = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/app/search?ignored=yes`,
      [definition(factory)],
      runtimeOptions(),
      NAVIGATION,
    );

    expect(factory).not.toHaveBeenCalled();
    adapter.authorizePackTools?.([SITE_TOOL]);
    // The factory also receives the page services carrying gated navigation.
    expect(factory).toHaveBeenCalledWith(DOCUMENT, {
      navigate: expect.any(Function) as unknown,
    });
    await expect(adapter.capabilities(signal())).resolves.toEqual([
      PACK_CAPABILITY,
    ]);
    await expect(adapter.execute(SITE_TOOL, {}, signal())).resolves.toEqual({
      source: "pack",
    });

    const outside = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/outside`,
      [definition(factory)],
      runtimeOptions(),
      NAVIGATION,
    );
    outside.authorizePackTools?.([SITE_TOOL]);
    await expect(outside.capabilities(signal())).resolves.toEqual([]);
    expect(factory).toHaveBeenCalledOnce();
  });

  it("publishes native and pack candidates but executes native precedence", async () => {
    const pack = fakeAdapter([PACK_CAPABILITY], { source: "pack" });
    const native = fakeAdapter([NATIVE_CAPABILITY], { source: "native" });
    const adapter = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/app/search`,
      [definition(() => pack.adapter)],
      runtimeOptions(),
      NAVIGATION,
      native.adapter,
    );
    adapter.authorizePackTools?.([SITE_TOOL]);

    await expect(adapter.capabilities(signal())).resolves.toEqual([
      NATIVE_CAPABILITY,
      PACK_CAPABILITY,
    ]);
    await expect(adapter.execute(SITE_TOOL, {}, signal())).resolves.toEqual({
      source: "native",
    });
    expect(native.execute).toHaveBeenCalledOnce();
    expect(pack.execute).not.toHaveBeenCalled();
  });

  it("revokes routes before change notification and unsubscribes every child", async () => {
    let packChanged: (() => void) | undefined;
    let nativeChanged: (() => void) | undefined;
    const packUnsubscribe = vi.fn();
    const nativeUnsubscribe = vi.fn();
    const pack = fakeAdapter([PACK_CAPABILITY], { source: "pack" }, (next) => {
      packChanged = next;
      return packUnsubscribe;
    });
    const native = fakeAdapter([], { source: "native" }, (next) => {
      nativeChanged = next;
      return nativeUnsubscribe;
    });
    const adapter = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/app/search`,
      [definition(() => pack.adapter)],
      runtimeOptions(),
      NAVIGATION,
      native.adapter,
    );
    adapter.authorizePackTools?.([SITE_TOOL]);
    await adapter.capabilities(signal());
    const changed = vi.fn();
    const unsubscribe = adapter.subscribe?.(changed);

    packChanged?.();
    expect(changed).toHaveBeenCalledOnce();
    await expectAdapterError(
      adapter.execute(SITE_TOOL, {}, signal()),
      "TOOL_UNAVAILABLE",
    );
    await adapter.capabilities(signal());
    nativeChanged?.();
    expect(changed).toHaveBeenCalledTimes(2);

    unsubscribe?.();
    expect(packUnsubscribe).toHaveBeenCalledOnce();
    expect(nativeUnsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects undeclared output, noncanonical authorization, and malformed definitions", async () => {
    const undeclared = fakeAdapter([{ source: "pack", name: OTHER_TOOL }], {});
    const adapter = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/app/search`,
      [definition(() => undeclared.adapter)],
      runtimeOptions(),
      NAVIGATION,
    );
    adapter.authorizePackTools?.([SITE_TOOL]);
    await expectAdapterError(
      adapter.capabilities(signal()),
      "EXECUTION_FAILED",
    );

    expect(() =>
      adapter.authorizePackTools?.([SITE_TOOL, "mcpatch.site.second"]),
    ).toThrow(TypeError);

    expect(() =>
      createReviewedDocumentAdapter(
        DOCUMENT,
        `${SITE_ORIGIN}/app/search`,
        [{ ...definition(() => undeclared.adapter), tools: [OTHER_TOOL] }],
        runtimeOptions(),
        NAVIGATION,
      ),
    ).toThrow(TypeError);
    expect(() =>
      createReviewedDocumentAdapter(
        DOCUMENT,
        `${SITE_ORIGIN}/app/search`,
        [
          definition(() => {
            throw new Error("factory details");
          }),
        ],
        runtimeOptions(),
        NAVIGATION,
      ).authorizePackTools?.([SITE_TOOL]),
    ).toThrow(TypeError);
  });

  it("maps SDK browser errors onto the closed page error contract", async () => {
    const browserAdapter: PageAdapter = {
      async capabilities() {
        throw new BrowserToolExecutionError("CANCELLED");
      },
      async execute() {
        throw new BrowserToolExecutionError("TOOL_UNAVAILABLE");
      },
    };
    const adapter = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/app/search`,
      [definition(() => browserAdapter)],
      runtimeOptions(),
      NAVIGATION,
    );
    adapter.authorizePackTools?.([SITE_TOOL]);

    await expectAdapterError(adapter.capabilities(signal()), "CANCELLED");

    const routedAdapter = createReviewedDocumentAdapter(
      DOCUMENT,
      `${SITE_ORIGIN}/app/search`,
      [
        definition(() => ({
          ...browserAdapter,
          async capabilities() {
            return [PACK_CAPABILITY];
          },
        })),
      ],
      runtimeOptions(),
      NAVIGATION,
    );
    routedAdapter.authorizePackTools?.([SITE_TOOL]);
    await routedAdapter.capabilities(signal());
    await expectAdapterError(
      routedAdapter.execute(SITE_TOOL, {}, signal()),
      "TOOL_UNAVAILABLE",
    );
  });
});

function definition(
  create: ReviewedPageAdapterDefinition["create"],
): ReviewedPageAdapterDefinition {
  return { pack: sitePack, tools: [SITE_TOOL], create };
}

function fakeAdapter(
  capabilities: readonly PageCapability[],
  result: JsonValue,
  subscribe?: (listener: () => void) => () => void,
) {
  const execute = vi.fn(
    async (_tool: string, _args: JsonObject, executionSignal: AbortSignal) => {
      executionSignal.throwIfAborted();
      return result;
    },
  );
  const adapter: PageAdapter = {
    async capabilities(discoverySignal) {
      discoverySignal.throwIfAborted();
      return capabilities;
    },
    execute,
    ...(subscribe === undefined ? {} : { subscribe }),
  };
  return { adapter, execute };
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

async function expectAdapterError(
  promise: Promise<unknown>,
  code: PageAdapterExecutionError["code"],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ code });
}
