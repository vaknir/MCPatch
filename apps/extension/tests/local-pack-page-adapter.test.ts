import { describe, expect, it, vi } from "vitest";
import {
  computeDeclarativePackBundleDigest,
  type PackToolReturn,
} from "@mcpatch/sdk/runtime";

import type { PageCapability } from "../src/page-channel.js";
import type { PageAdapter } from "../src/page-content-model.js";
import { PageAdapterExecutionError } from "../src/page-content-model.js";
import { CompositePageAdapter } from "../src/local-pack-page-adapter.js";
import { fixtureLocalBundle } from "../e2e/fixture-local-bundle.js";
import { packRuntime } from "./support/compiled-pack.js";

const TOOL = "example.items.current";

describe("local pack page adapter composition", () => {
  it("pins the disposable-browser unsigned fixture to its exact content", async () => {
    await expect(
      computeDeclarativePackBundleDigest(fixtureLocalBundle),
    ).resolves.toBe(fixtureLocalBundle.manifest.digest);
    await expect(
      packRuntime([]).runtime.replaceDeclarativeDefinitions([
        fixtureLocalBundle,
      ]),
    ).resolves.toBe(true);
  });

  it("routes a unique declarative tool and forwards the exact authorization", async () => {
    const child = fakeAdapter([{ source: "pack", name: TOOL }], {
      text: "visible",
    });
    const composite = new CompositePageAdapter([child.adapter]);

    composite.authorizePackTools?.([TOOL]);
    expect(await composite.capabilities(new AbortController().signal)).toEqual([
      { source: "pack", name: TOOL },
    ]);
    await expect(
      composite.execute(TOOL, {}, new AbortController().signal),
    ).resolves.toEqual({ text: "visible" });
    expect(child.authorize).toHaveBeenCalledWith([TOOL]);
    expect(child.execute).toHaveBeenCalledOnce();
  });

  it("reports an ambiguous pack name once but creates no executable route", async () => {
    const first = fakeAdapter([{ source: "pack", name: TOOL }], { source: 1 });
    const second = fakeAdapter([{ source: "pack", name: TOOL }], { source: 2 });
    const composite = new CompositePageAdapter([first.adapter, second.adapter]);

    expect(await composite.capabilities(new AbortController().signal)).toEqual([
      { source: "pack", name: TOOL },
    ]);
    expect(() =>
      composite.execute(TOOL, {}, new AbortController().signal),
    ).toThrow(PageAdapterExecutionError);
    expect(first.execute).not.toHaveBeenCalled();
    expect(second.execute).not.toHaveBeenCalled();
  });

  it("keeps native precedence when a local pack reports the same page name", async () => {
    const native = fakeAdapter(
      [
        {
          source: "native_webmcp",
          name: TOOL,
          description: "Native page tool",
          inputSchema: {},
          annotations: {
            readOnlyHint: true,
            consequentialHint: false,
            untrustedContentHint: true,
          },
        },
      ],
      { source: "native" },
    );
    const pack = fakeAdapter([{ source: "pack", name: TOOL }], {
      source: "pack",
    });
    const composite = new CompositePageAdapter([native.adapter, pack.adapter]);

    expect(
      await composite.capabilities(new AbortController().signal),
    ).toHaveLength(2);
    await expect(
      composite.execute(TOOL, {}, new AbortController().signal),
    ).resolves.toEqual({ source: "native" });
    expect(native.execute).toHaveBeenCalledOnce();
    expect(pack.execute).not.toHaveBeenCalled();
  });

  it("revokes every child route and subscription when closed", async () => {
    const first = fakeAdapter([{ source: "pack", name: TOOL }], {});
    const second = fakeAdapter(
      [{ source: "pack", name: "example.items.other" }],
      {},
    );
    const composite = new CompositePageAdapter([first.adapter, second.adapter]);
    const unsubscribe = composite.subscribe?.(() => undefined);
    await composite.capabilities(new AbortController().signal);

    unsubscribe?.();
    composite.close?.();

    expect(first.unsubscribe).toHaveBeenCalledOnce();
    expect(second.unsubscribe).toHaveBeenCalledOnce();
    expect(first.close).toHaveBeenCalledOnce();
    expect(second.close).toHaveBeenCalledOnce();
    expect(() =>
      composite.execute(TOOL, {}, new AbortController().signal),
    ).toThrow(PageAdapterExecutionError);
  });

  it("keeps established routes live until asynchronous rediscovery replaces them", async () => {
    const child = fakeAdapter([{ source: "pack", name: TOOL }], {
      text: "current",
    });
    const refresh = vi.fn();
    const composite = new CompositePageAdapter([child.adapter]);
    composite.subscribe?.(refresh);
    await composite.capabilities(new AbortController().signal);

    child.notify();

    expect(refresh).toHaveBeenCalledOnce();
    await expect(
      composite.execute(TOOL, {}, new AbortController().signal),
    ).resolves.toEqual({ text: "current" });
  });
});

function fakeAdapter(
  capabilities: readonly PageCapability[],
  result: PackToolReturn,
) {
  let listener: (() => void) | undefined;
  const authorize = vi.fn();
  const execute = vi.fn(async () => result);
  const unsubscribe = vi.fn();
  const close = vi.fn();
  const adapter: PageAdapter = {
    authorizePackTools: authorize,
    async capabilities() {
      return capabilities;
    },
    execute,
    subscribe(next) {
      listener = next;
      return unsubscribe;
    },
    close,
  };
  return {
    adapter,
    authorize,
    execute,
    unsubscribe,
    close,
    notify() {
      listener?.();
    },
  };
}
