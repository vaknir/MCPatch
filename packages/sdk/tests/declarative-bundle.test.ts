import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Ajv2020, type AnySchema } from "ajv/dist/2020.js";
import * as ed25519 from "@noble/ed25519";
import { describe, expect, it } from "vitest";

import {
  canonicalizeDeclarativePackBundle,
  computeDeclarativePackBundleDigest,
  decodeDeclarativePackBundle,
  MAX_BUNDLE_JSON_DEPTH,
  MAX_BUNDLE_OBJECT_FIELDS,
  MAX_BUNDLE_STRING_CODE_POINTS,
  MAX_DECLARATIVE_BUNDLE_BYTES,
  parseDeclarativePackBundle,
  parseDeclarativePackBundleBytes,
  publisherKeyId,
  registryAttestationSigningBytes,
  serializeDeclarativePackBundle,
  signDeclarativePackBundle,
  validateDeclarativePackBundle,
  verifyDeclarativePackBundle,
  verifyRegistryAttestation,
} from "../src/index.js";
import type {
  DeclarativePackBundle,
  DeclarativePackBundleContent,
  RegistryAttestation,
} from "../src/index.js";
import type { JsonValue } from "../src/index.js";
import { DeclarativePackBundleValidationError } from "../src/index.js";
import { canonicalizeOrThrow } from "../src/declarative-bundle-canonical.js";
import { DOMAIN_DIGEST } from "../src/declarative-bundle-canonical.js";

const manifestFixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../fixtures/v1/valid/declarative-example.json", import.meta.url),
    ),
    "utf8",
  ),
) as DeclarativePackBundleContent["manifest"];

describe("Declarative Pack Bundle v1", () => {
  it("accepts the self-contained schema and rejects bundled execution", async () => {
    const schema = JSON.parse(
      readFileSync(
        fileURLToPath(
          new URL(
            "../schema/v1/declarative-pack-bundle.schema.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as AnySchema;
    const validateSchema = new Ajv2020({
      strict: true,
      validateFormats: false,
    }).compile(schema);
    const bundle = fixtureBundle();
    expect(validateSchema(bundle)).toBe(true);
    expect(validateDeclarativePackBundle(bundle)).toBeUndefined();
    const unicodeLicense = {
      ...bundle,
      metadata: { ...bundle.metadata, license: "é".repeat(128) },
    };
    expect(validateSchema(unicodeLicense)).toBe(true);
    expect(validateDeclarativePackBundle(unicodeLicense)).toBeUndefined();
    const overlongUnicodeLicense = {
      ...bundle,
      metadata: { ...bundle.metadata, license: "é".repeat(129) },
    };
    expect(validateSchema(overlongUnicodeLicense)).toBe(false);
    expect(validateDeclarativePackBundle(overlongUnicodeLicense)).toMatchObject(
      {
        code: "INVALID_VALUE",
        field: "metadata.license",
      },
    );
    const unknownProgram = {
      ...bundle,
      operations: {
        ...bundle.operations,
        program: "reserved-for-operations-v2",
      },
    };
    expect(validateSchema(unknownProgram)).toBe(false);
    expect(validateDeclarativePackBundle(unknownProgram)).toMatchObject({
      code: "INVALID_TYPE",
      field: "operations.program",
    });
    const bundled = structuredClone(bundle) as Record<string, unknown>;
    (bundled.manifest as Record<string, unknown>).execution = {
      kind: "bundled",
    };
    expect(validateDeclarativePackBundle(bundled)).toEqual({
      code: "INVALID_VALUE",
      field: "manifest.execution",
    });
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });

  it("is immutable and emits the same JCS bytes for reordered object fields", () => {
    const bundle = parseDeclarativePackBundle(fixtureBundle());
    const reordered = JSON.parse(JSON.stringify(bundle)) as Record<
      string,
      unknown
    >;
    const manifest = reordered.manifest as Record<string, unknown>;
    reordered.manifest = {
      fixtures: manifest.fixtures,
      tools: manifest.tools,
      networkPolicy: manifest.networkPolicy,
      matches: manifest.matches,
      execution: manifest.execution,
      compatibility: manifest.compatibility,
      digest: manifest.digest,
      version: manifest.version,
      description: manifest.description,
      name: manifest.name,
      id: manifest.id,
      publisher: manifest.publisher,
      manifestVersion: manifest.manifestVersion,
    };
    expect(canonicalizeDeclarativePackBundle(bundle)).toBe(
      canonicalizeDeclarativePackBundle(reordered as DeclarativePackBundle),
    );
    expect(serializeDeclarativePackBundle(bundle)).toEqual(
      serializeDeclarativePackBundle(reordered as DeclarativePackBundle),
    );
    expect(
      parseDeclarativePackBundleBytes(serializeDeclarativePackBundle(bundle)),
    ).toEqual(bundle);
    expect(Object.isFrozen(bundle)).toBe(true);
    expect(Object.isFrozen(bundle.operations.program)).toBe(true);
  });

  it("keeps array order significant and rejects duplicate keys before object semantics", () => {
    const first = decodeDeclarativePackBundle('{"value":[1,2]}');
    const second = decodeDeclarativePackBundle('{"value":[2,1]}');
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second));
    for (const json of [
      '{"a":1,"a":2}',
      '{"a":1,"\\u0061":2}',
      '{"nested":{"x":1,"x":2}}',
    ]) {
      expect(() => decodeDeclarativePackBundle(json)).toThrowError(
        DeclarativePackBundleValidationError,
      );
      expect(() => decodeDeclarativePackBundle(json)).toThrow(/DUPLICATE_KEY/);
    }
  });

  it("preserves Unicode normalization forms and canonical UTF-16 key ordering", () => {
    const composed = bundleWithProgram("é");
    const decomposed = bundleWithProgram("e\u0301");
    const composedText = canonicalizeDeclarativePackBundle(composed);
    const decomposedText = canonicalizeDeclarativePackBundle(decomposed);
    expect(composedText).not.toBe(decomposedText);
    expect(composedText).toContain("é");
  });

  it("accepts the checked-in deterministic canonical-byte vector", async () => {
    const vector = readFileSync(
      fileURLToPath(
        new URL("../fixtures/v1/canonical-vector.json", import.meta.url),
      ),
      "utf8",
    );
    const canonical = canonicalizeOrThrow({
      b: "é",
      a: [2, 1],
      "10": "ten",
      "2": "two",
    });
    expect(vector.trimEnd()).toBe(canonical);
    const bytes = new TextEncoder().encode(vector.trimEnd());
    expect(toHex(bytes)).toBe(
      "7b223130223a2274656e222c2232223a2274776f222c2261223a5b322c315d2c2262223a22c3a9227d",
    );
    const digestInput = new Uint8Array(
      new TextEncoder().encode(DOMAIN_DIGEST).byteLength + bytes.byteLength,
    );
    digestInput.set(new TextEncoder().encode(DOMAIN_DIGEST));
    digestInput.set(bytes, new TextEncoder().encode(DOMAIN_DIGEST).byteLength);
    const digest = await crypto.subtle.digest("SHA-256", digestInput);
    expect(toHex(new Uint8Array(digest))).toBe(
      "cd3fcd303e538d334c296cdfbe2c25a0aeaacda8c5862cbe4b462f0ff3f61cf8",
    );
    const signature = await ed25519.signAsync(bytes, rfc8032Keys().privateKey);
    expect(toHex(signature)).toBe(
      "7a69e63016c3ef37fd01d7ebb4b651a07c6ad314f0ea8adf990fe6623c4a01c1c660b07f275ef7aace43e951716acd3cf78b1cd63c89ef8a6821f743fdad8f08",
    );
  });

  it("rejects invalid UTF-8, truncation, lone surrogates, noncharacters, unsafe numbers, and -0", () => {
    expect(() =>
      decodeDeclarativePackBundle(new Uint8Array([0xc3, 0x28])),
    ).toThrow(/INVALID_JSON/);
    for (const json of [
      '{"value":',
      '{"value":"\\ud800"}',
      '{"value":"\\ufdd0"}',
      '{"value":9007199254740992}',
      '{"value":-0}',
      '{"value":1e400}',
    ]) {
      expect(() => decodeDeclarativePackBundle(json), json).toThrow(
        DeclarativePackBundleValidationError,
      );
    }
  });

  it("enforces exact parser collection and string limits", () => {
    expect(
      decodeDeclarativePackBundle("[" + "0,".repeat(511) + "0]"),
    ).toHaveLength(512);
    expect(() =>
      decodeDeclarativePackBundle("[" + "0,".repeat(512) + "0]"),
    ).toThrow(/LIMIT_EXCEEDED/);
    expect(
      decodeDeclarativePackBundle(JSON.stringify("x".repeat(16 * 1024))),
    ).toBe("x".repeat(16 * 1024));
    expect(() =>
      decodeDeclarativePackBundle(JSON.stringify("x".repeat(16 * 1024 + 1))),
    ).toThrow(/LIMIT_EXCEEDED/);
    expect(() =>
      decodeDeclarativePackBundle(
        JSON.stringify("é".repeat(MAX_BUNDLE_STRING_CODE_POINTS)),
      ),
    ).not.toThrow();
    expect(() =>
      decodeDeclarativePackBundle(
        JSON.stringify("é".repeat(MAX_BUNDLE_STRING_CODE_POINTS + 1)),
      ),
    ).toThrow(/LIMIT_EXCEEDED/);
    expect(() =>
      decodeDeclarativePackBundle(
        JSON.stringify({ ["é".repeat(MAX_BUNDLE_STRING_CODE_POINTS)]: 0 }),
      ),
    ).not.toThrow();
    expect(() =>
      decodeDeclarativePackBundle(
        JSON.stringify({ ["é".repeat(MAX_BUNDLE_STRING_CODE_POINTS + 1)]: 0 }),
      ),
    ).toThrow(/LIMIT_EXCEEDED/);
    expect(() =>
      parseDeclarativePackBundle(bundleWithProgram({ ["\ud800"]: 0 })),
    ).toThrow(/INVALID_/);
    expect(() =>
      parseDeclarativePackBundle(bundleWithProgram({ ["\ufdd0"]: 0 })),
    ).toThrow(/INVALID_/);
    const cyclicProgram = {} as Record<string, unknown>;
    cyclicProgram.self = cyclicProgram;
    expect(() =>
      parseDeclarativePackBundle(bundleWithProgram(cyclicProgram as JsonValue)),
    ).toThrow(/INVALID_/);
  });

  it("keeps object APIs subject to the same aggregate and member-name bounds", async () => {
    const exactProgram = bundleWithProgram("é".repeat(4_096));
    expect(() => parseDeclarativePackBundle(exactProgram)).not.toThrow();
    await expect(
      computeDeclarativePackBundleDigest(exactProgram),
    ).resolves.toMatch(/^sha256:/u);
    const exactContent = await withComputedDigest(exactProgram);
    await expect(
      signDeclarativePackBundle(exactContent, rfc8032Keys()),
    ).resolves.toBeDefined();

    const overlongProgram = bundleWithProgram("é".repeat(4_097));
    expect(() => parseDeclarativePackBundle(overlongProgram)).toThrow(
      /LIMIT_EXCEEDED/,
    );
    await expect(
      computeDeclarativePackBundleDigest(overlongProgram),
    ).rejects.toThrow(/LIMIT_EXCEEDED/);

    const oversizedProgram = bundleWithProgram(
      Array.from({ length: 64 }, () => "x".repeat(4_096)),
    );
    expect(() => parseDeclarativePackBundle(oversizedProgram)).toThrow(
      /LIMIT_EXCEEDED/,
    );
    await expect(
      computeDeclarativePackBundleDigest(oversizedProgram),
    ).rejects.toThrow(/LIMIT_EXCEEDED/);
  });

  it("enforces exact raw-byte, depth, node, and object limits", () => {
    const exactBytes = "0" + " ".repeat(MAX_DECLARATIVE_BUNDLE_BYTES - 1);
    expect(() => decodeDeclarativePackBundle(exactBytes)).not.toThrow();
    expect(() => decodeDeclarativePackBundle(exactBytes + " ")).toThrow(
      /LIMIT_EXCEEDED/,
    );

    const nested = (depth: number): string =>
      "[".repeat(depth) + "0" + "]".repeat(depth);
    expect(() =>
      decodeDeclarativePackBundle(nested(MAX_BUNDLE_JSON_DEPTH)),
    ).not.toThrow();
    expect(() =>
      decodeDeclarativePackBundle(nested(MAX_BUNDLE_JSON_DEPTH + 1)),
    ).toThrow(/LIMIT_EXCEEDED/);

    const exactNodes = [
      ...Array.from({ length: 511 }, () => Array.from({ length: 15 }, () => 0)),
      Array.from({ length: 14 }, () => 0),
    ];
    expect(() =>
      decodeDeclarativePackBundle(JSON.stringify(exactNodes)),
    ).not.toThrow();
    expect(() =>
      decodeDeclarativePackBundle(JSON.stringify([...exactNodes, [0, 0]])),
    ).toThrow(/LIMIT_EXCEEDED/);

    const exactObject = Object.fromEntries(
      Array.from({ length: MAX_BUNDLE_OBJECT_FIELDS }, (_, index) => [
        `k${index}`,
        0,
      ]),
    );
    expect(() =>
      decodeDeclarativePackBundle(JSON.stringify(exactObject)),
    ).not.toThrow();
    expect(() =>
      decodeDeclarativePackBundle(JSON.stringify({ ...exactObject, extra: 0 })),
    ).toThrow(/LIMIT_EXCEEDED/);
  });

  it("computes a stable domain-separated digest over the canonical content payload", async () => {
    const bundle = fixtureBundle();
    const digest = await computeDeclarativePackBundleDigest(bundle);
    expect(digest).toBe(
      "sha256:71ee26e441ae053582e39e78c3cb339fb92afe960df5a40c6aee979e6a47aa07",
    );
    const reordered = structuredClone(bundle) as {
      operations: { readonly program: unknown; readonly operationsVersion: 1 };
    } & Omit<DeclarativePackBundle, "operations">;
    const operations = reordered.operations;
    reordered.operations = {
      program: operations.program,
      operationsVersion: operations.operationsVersion,
    };
    expect(
      await computeDeclarativePackBundleDigest(
        reordered as unknown as DeclarativePackBundle,
      ),
    ).toBe(digest);
  });

  it("signs and verifies with a trusted Ed25519 key lookup", async () => {
    const keys = rfc8032Keys();
    const content = await withComputedDigest(fixtureBundle());
    const signed = await signDeclarativePackBundle(content, keys);
    const publicKey = encodeBase64Url(keys.publicKey);
    await expect(
      verifyDeclarativePackBundle(serializeDeclarativePackBundle(signed), {
        trustedPublicKey: publicKey,
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      verifyDeclarativePackBundle(serializeDeclarativePackBundle(signed)),
    ).resolves.toMatchObject({
      ok: false,
      issue: { code: "INVALID_SIGNATURE" },
    });
    const substituted = structuredClone(signed) as {
      publisherSignature: { publicKey: string };
    } & Omit<DeclarativePackBundle, "publisherSignature">;
    substituted.publisherSignature.publicKey = encodeBase64Url(
      new Uint8Array(32),
    );
    await expect(
      verifyDeclarativePackBundle(
        serializeDeclarativePackBundle(
          substituted as unknown as DeclarativePackBundle,
        ),
        { trustedPublicKey: publicKey },
      ),
    ).resolves.toMatchObject({ ok: false, issue: { code: "KEY_ID_MISMATCH" } });
  });

  it("rejects identity replay, bit flips, and incompatible runtimes", async () => {
    const keys = rfc8032Keys();
    const content = await withComputedDigest(fixtureBundle());
    const signed = await signDeclarativePackBundle(content, keys);
    const publicKey = encodeBase64Url(keys.publicKey);
    const replay = structuredClone(signed) as {
      manifest: { id: string };
    } & Omit<DeclarativePackBundle, "manifest">;
    replay.manifest.id = "other-pack";
    await expect(
      verifyDeclarativePackBundle(
        serializeDeclarativePackBundle(
          replay as unknown as DeclarativePackBundle,
        ),
        {
          trustedPublicKey: publicKey,
        },
      ),
    ).resolves.toMatchObject({ ok: false, issue: { code: "DIGEST_MISMATCH" } });
    const flipped = structuredClone(signed) as {
      publisherSignature: { signature: string };
    } & Omit<DeclarativePackBundle, "publisherSignature">;
    const flippedSignature = flipped.publisherSignature.signature;
    flipped.publisherSignature.signature =
      (flippedSignature.startsWith("A") ? "B" : "A") +
      flippedSignature.slice(1);
    await expect(
      verifyDeclarativePackBundle(
        serializeDeclarativePackBundle(
          flipped as unknown as DeclarativePackBundle,
        ),
        {
          trustedPublicKey: publicKey,
        },
      ),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      verifyDeclarativePackBundle(serializeDeclarativePackBundle(signed), {
        trustedPublicKey: publicKey,
        runtimeVersion: "9.0.0",
      }),
    ).resolves.toMatchObject({
      ok: false,
      issue: { code: "INCOMPATIBLE" },
    });
  });

  it("matches the RFC 8032 Ed25519 test vector without native WebCrypto Ed25519", async () => {
    const seed = hexToBytes(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    );
    const publicKey = hexToBytes(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    );
    const signature = await ed25519.signAsync(new Uint8Array(), seed);
    expect(toHex(signature)).toBe(
      "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155" +
        "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
    );
    await expect(
      ed25519.verifyAsync(signature, new Uint8Array(), publicKey),
    ).resolves.toBe(true);
  });

  it("rejects a ZIP-215-only small-order vector in strict RFC 8032 mode", async () => {
    const message = new TextEncoder().encode("Zcash");
    const publicKey = hexToBytes(
      "0100000000000000000000000000000000000000000000000000000000000000",
    );
    const signature = hexToBytes(
      "0100000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
    await expect(
      ed25519.verifyAsync(signature, message, publicKey, { zip215: true }),
    ).resolves.toBe(true);
    await expect(
      ed25519.verifyAsync(signature, message, publicKey, { zip215: false }),
    ).resolves.toBe(false);
  });

  it("rejects a ZIP-215-only small-order publisher signature through the public verifier", async () => {
    const content = await withComputedDigest(fixtureBundle());
    const signed = await signDeclarativePackBundle(content, rfc8032Keys());
    const smallOrderPublicKey = hexToBytes(
      "0100000000000000000000000000000000000000000000000000000000000000",
    );
    const smallOrderSignature = hexToBytes(
      "0100000000000000000000000000000000000000000000000000000000000000" +
        "0000000000000000000000000000000000000000000000000000000000000000",
    );
    const publicKey = encodeBase64Url(smallOrderPublicKey);
    const zip215Bundle = {
      ...signed,
      publisherSignature: {
        ...signed.publisherSignature,
        keyId: await publisherKeyId("example", publicKey),
        publicKey,
        signature: encodeBase64Url(smallOrderSignature),
      },
    };
    await expect(
      verifyDeclarativePackBundle(
        serializeDeclarativePackBundle(zip215Bundle),
        {
          trustedPublicKey: publicKey,
        },
      ),
    ).resolves.toMatchObject({
      ok: false,
      issue: { code: "INVALID_SIGNATURE" },
    });
  });

  it("keeps registry review attestation in a separate signing domain", async () => {
    const bundle = await withComputedDigest(fixtureBundle());
    const publicKey = encodeBase64Url(rfc8032Keys().publicKey);
    const attestationBase: Omit<RegistryAttestation, "signature" | "keyId"> = {
      attestationVersion: 1,
      registryId: "mcp-registry",
      publisher: "example",
      id: "read-page",
      version: "1.2.3",
      bundleDigest: bundle.manifest.digest,
      publicationSequence: 7,
      reviewState: "REVIEWED_COMMUNITY",
      issuedAt: "2026-09-16T00:00:00.000Z",
      expiresAt: "2026-09-17T00:00:00.000Z",
    };
    const attestationForSigning = {
      ...attestationBase,
      keyId: await publisherKeyId("mcp-registry", publicKey),
      signature: encodeBase64Url(new Uint8Array(64)),
    } as RegistryAttestation;
    const attestation: RegistryAttestation = {
      ...attestationForSigning,
      signature: encodeBase64Url(
        await ed25519.signAsync(
          registryAttestationSigningBytes(attestationForSigning),
          rfc8032Keys().privateKey,
        ),
      ),
    };
    const parsed = parseDeclarativePackBundle({
      ...bundle,
      publisherSignature: fixtureBundle().publisherSignature,
      registryAttestation: attestation,
    });
    expect(parsed.registryAttestation?.reviewState).toBe("REVIEWED_COMMUNITY");
    await expect(
      verifyRegistryAttestation(JSON.stringify(attestation), {
        publicKey,
        expectedRegistryId: "mcp-registry",
        now: new Date("2026-09-16T12:00:00.000Z"),
      }),
    ).resolves.toBe(true);

    await expect(
      verifyRegistryAttestation(
        JSON.stringify({ ...attestation, issuedAt: "2026-09-16T00:00:00Z" }),
        {
          publicKey,
          expectedRegistryId: "mcp-registry",
          now: new Date("2026-09-16T12:00:00.000Z"),
        },
      ),
    ).resolves.toBe(false);
    await expect(
      verifyRegistryAttestation(JSON.stringify(attestation), {
        publicKey,
        expectedRegistryId: "mcp-registry",
        now: new Date("not-a-date"),
      }),
    ).resolves.toBe(false);
    await expect(
      verifyRegistryAttestation(JSON.stringify(attestation), {
        publicKey: "not-a-key",
        expectedRegistryId: "other-registry",
      }),
    ).resolves.toBe(false);
  });

  it("requires canonical HTTPS homepages and keeps validation errors payload-safe", () => {
    for (const homepage of [
      "http://example.test/pack",
      "https://example.test/",
      "https://EXAMPLE.TEST/pack",
      "https://example.test:443/pack",
      "https://user:password@example.test/pack",
      "https://example.test/pack#fragment",
    ]) {
      expect(
        validateDeclarativePackBundle({
          ...fixtureBundle(),
          metadata: { ...fixtureBundle().metadata, homepage },
        }),
      ).toMatchObject({
        code: "INVALID_VALUE",
        field: "metadata.homepage",
      });
    }
    const hostileKey = "secret-user-key-path";
    const invalid = { ...fixtureBundle(), [hostileKey]: true };
    expect(() => parseDeclarativePackBundle(invalid)).toThrow(
      "UNKNOWN_FIELD at bundle",
    );
    expect(() =>
      decodeDeclarativePackBundle(`{"${hostileKey}":1,"${hostileKey}":2}`),
    ).toThrow("DUPLICATE_KEY at $");
  });
});

function fixtureBundle(): DeclarativePackBundle {
  return {
    bundleVersion: 1,
    manifest: structuredClone(manifestFixture),
    operations: {
      operationsVersion: 1,
      program: {
        version: 1,
        operations: [
          {
            kind: "read",
            tool: "example.items.current",
            availability: {
              kind: "present",
              locator: { kind: "role", role: "main" },
            },
            scope: {
              kind: "single",
              locator: { kind: "role", role: "main" },
            },
            projection: {
              kind: "object",
              fields: [{ key: "text", value: { kind: "text" } }],
            },
          },
        ],
      },
    },
    metadata: {
      license: "MIT",
      homepage: "https://example.test/declarative-read",
      sourceCommit: "a".repeat(40),
    },
    publisherSignature: {
      signatureVersion: 1,
      algorithm: "Ed25519",
      publisher: "example",
      keyId: "ed25519:example:sha256:" + "0".repeat(64),
      publicKey: "A".repeat(43),
      signature: "A".repeat(86),
    },
  };
}

function bundleWithProgram(program: JsonValue): DeclarativePackBundle {
  const bundle = structuredClone(fixtureBundle()) as unknown as {
    manifest: { tools: Array<{ outputSchema: unknown }> };
    operations: { program: { operations: Array<{ projection: unknown }> } };
  };
  const operation = bundle.operations.program.operations[0];
  if (operation === undefined) throw new Error("fixture operation missing");
  operation.projection = {
    kind: "object",
    fields: [{ key: "value", value: { kind: "constant", value: program } }],
  };
  // The declared output schema has to describe whatever projection the test
  // swaps in: a tool's output schema is closed, so it can neither omit the
  // projected key nor admit one the projection never produces.
  const tool = bundle.manifest.tools[0];
  if (tool === undefined) throw new Error("fixture tool missing");
  tool.outputSchema = {
    type: "object",
    additionalProperties: false,
    required: ["value"],
    properties: {
      // A string constant is described by its type so the byte-bound cases
      // measure the program alone; any other constant is pinned exactly.
      value:
        typeof program === "string" ? { type: "string" } : { const: program },
    },
  };
  return bundle as unknown as DeclarativePackBundle;
}

async function withComputedDigest(
  bundle: DeclarativePackBundle,
): Promise<DeclarativePackBundleContent> {
  const content = structuredClone(bundle) as DeclarativePackBundleContent;
  const digest = await computeDeclarativePackBundleDigest({
    bundleVersion: content.bundleVersion,
    operations: content.operations,
    metadata: content.metadata,
    manifest: {
      ...content.manifest,
      digest: "sha256:" + "0".repeat(64),
    },
  });
  return {
    bundleVersion: content.bundleVersion,
    operations: content.operations,
    metadata: content.metadata,
    manifest: { ...content.manifest, digest },
  };
}

function encodeBase64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function rfc8032Keys(): {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
} {
  return {
    privateKey: hexToBytes(
      "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    ),
    publicKey: hexToBytes(
      "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    ),
  };
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
