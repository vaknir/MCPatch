import { describe, expect, it, vi } from "vitest";

import type { DeclarativePackBundleContent } from "@mcpatch/sdk/runtime";

import type { CompiledPackRuntime } from "../src/compiled-pack-runtime.js";
import { DeclarativeDefinitionCatalog } from "../src/declarative-definition-catalog.js";
import { localBundle } from "./support/local-pack.js";

describe("declarative definition catalog", () => {
  it("combines independent sources in deterministic source order", async () => {
    const first = await bundle("first", "example.first.current");
    const second = await bundle("second", "example.second.current");
    const replace = vi.fn(async () => true);
    const catalog = new DeclarativeDefinitionCatalog();
    const local = catalog.createSource("local");
    const community = catalog.createSource("community");
    catalog.setRuntime(runtime(replace));

    await expect(local.replace([first])).resolves.toBe(true);
    await expect(community.replace([second])).resolves.toBe(true);

    expect(replace).toHaveBeenNthCalledWith(1, [first]);
    expect(replace).toHaveBeenNthCalledWith(2, [first, second]);
  });

  it("rejects duplicate identities without changing the established runtime", async () => {
    const established = await bundle("established", "example.first.current");
    const duplicate = await bundle("established", "example.other.current");
    const replace = vi.fn(async () => true);
    const catalog = new DeclarativeDefinitionCatalog();
    const local = catalog.createSource("local");
    const community = catalog.createSource("community");
    catalog.setRuntime(runtime(replace));
    await local.replace([established]);

    await expect(community.replace([duplicate])).resolves.toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("rolls back source state when the runtime rejects or throws", async () => {
    const established = await bundle("established", "example.first.current");
    const rejected = await bundle("rejected", "example.second.current");
    const thrown = await bundle("thrown", "example.third.current");
    const replace = vi
      .fn<(bundles: readonly unknown[]) => Promise<boolean>>()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error("private-runtime-error"))
      .mockResolvedValueOnce(true);
    const catalog = new DeclarativeDefinitionCatalog();
    const source = catalog.createSource("community");
    catalog.setRuntime(runtime(replace));

    await expect(source.replace([established])).resolves.toBe(true);
    await expect(source.replace([rejected])).resolves.toBe(false);
    expect(replace).toHaveBeenNthCalledWith(3, [established]);
    await expect(source.replace([thrown])).resolves.toBe(false);
    expect(replace).toHaveBeenNthCalledWith(5, [established]);
  });

  it("serializes concurrent replacements and enforces aggregate bounds", async () => {
    const first = await bundle("first", "example.first.current");
    const second = await bundle("second", "example.second.current");
    const calls: string[][] = [];
    const replace = vi.fn(async (bundles: readonly unknown[]) => {
      calls.push(
        (bundles as readonly DeclarativePackBundleContent[]).map(
          (value) => value.manifest.id,
        ),
      );
      await Promise.resolve();
      return true;
    });
    const catalog = new DeclarativeDefinitionCatalog();
    const source = catalog.createSource("community");
    catalog.setRuntime(runtime(replace));

    await expect(
      Promise.all([source.replace([first]), source.replace([second])]),
    ).resolves.toEqual([true, true]);
    expect(calls).toEqual([["first"], ["second"]]);
    await expect(source.replace(Array(65).fill(second))).resolves.toBe(false);
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("rejects duplicate source names and replacement before runtime binding", async () => {
    const content = await bundle("first", "example.first.current");
    const catalog = new DeclarativeDefinitionCatalog();
    const source = catalog.createSource("community");

    expect(() => catalog.createSource("community")).toThrow(TypeError);
    await expect(source.replace([content])).resolves.toBe(false);
  });
});

async function bundle(
  id: string,
  toolName: string,
): Promise<DeclarativePackBundleContent> {
  return localBundle((value) => {
    const manifest = value["manifest"] as Record<string, unknown>;
    manifest["id"] = id;
    const tools = manifest["tools"] as Array<Record<string, unknown>>;
    const tool = tools[0];
    if (tool === undefined) throw new Error("fixture tool missing");
    tool["name"] = toolName;
    const fixtures = manifest["fixtures"] as Array<Record<string, unknown>>;
    const fixture = fixtures[0];
    if (fixture === undefined) throw new Error("fixture missing");
    fixture["tool"] = toolName;
    const operations = value["operations"] as {
      program: { operations: Array<Record<string, unknown>> };
    };
    const operation = operations.program.operations[0];
    if (operation === undefined) throw new Error("fixture operation missing");
    operation["tool"] = toolName;
  });
}

function runtime(
  replace: (bundles: readonly unknown[]) => Promise<boolean>,
): CompiledPackRuntime {
  return {
    replaceDeclarativeDefinitions: replace,
  } as unknown as CompiledPackRuntime;
}
