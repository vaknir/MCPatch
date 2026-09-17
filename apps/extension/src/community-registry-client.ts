import {
  MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
  MAX_DECLARATIVE_BUNDLE_BYTES,
  verifyCommunityRegistryIndex,
  verifyDeclarativePackBundle,
  verifyRegistryAttestation,
  type CommunityRegistryIndex,
  type CommunityRegistryPackEntry,
  type DeclarativePackBundle,
  type DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import type { CompiledPackRuntimeOptions } from "./compiled-pack-validation.js";

const INDEX_CONTENT_TYPE = "application/vnd.mcpatch.registry-index+json";
const BUNDLE_CONTENT_TYPE = "application/vnd.mcpatch.pack+json";
const FETCH_TIMEOUT_MS = 10_000;

export interface CommunityRegistryConfiguration {
  readonly origin: string;
  readonly indexPath: string;
  readonly registryId: string;
  readonly publicKey: string;
}

export interface RegistryFetchResponse {
  readonly body: ReadableStream<Uint8Array> | null;
  readonly headers: { get(name: string): string | null };
  readonly ok: boolean;
  readonly redirected: boolean;
  readonly status: number;
  readonly url: string;
}

export type RegistryFetch = (
  input: string,
  init: Readonly<{
    readonly cache: "no-store";
    readonly credentials: "omit";
    readonly redirect: "error";
    readonly referrerPolicy: "no-referrer";
    readonly signal: AbortSignal;
  }>,
) => Promise<RegistryFetchResponse>;

export type RegistryClientErrorCode =
  "BUNDLE_REJECTED" | "INDEX_REJECTED" | "NETWORK_REJECTED" | "PACK_REVOKED";

export class RegistryClientError extends Error {
  readonly code: RegistryClientErrorCode;

  constructor(code: RegistryClientErrorCode) {
    super(code);
    this.name = "RegistryClientError";
    this.code = code;
  }
}

export interface VerifiedCommunityPack {
  readonly bundle: DeclarativePackBundle;
  readonly content: DeclarativePackBundleContent;
  readonly entry: CommunityRegistryPackEntry;
  readonly indexSequence: number;
}

/** Fixed-origin, credential-free registry transport plus local cryptographic proof. */
export class CommunityRegistryClient {
  readonly #configuration: CommunityRegistryConfiguration;
  readonly #fetch: RegistryFetch;
  readonly #runtime: CompiledPackRuntimeOptions;

  constructor(
    configuration: CommunityRegistryConfiguration,
    runtime: CompiledPackRuntimeOptions,
    fetchImplementation: RegistryFetch,
  ) {
    validateConfiguration(configuration);
    this.#configuration = Object.freeze({ ...configuration });
    this.#runtime = runtime;
    this.#fetch = fetchImplementation;
  }

  async index(
    minimumPublicationSequence: number,
    now: Date,
  ): Promise<CommunityRegistryIndex> {
    const url = `${this.#configuration.origin}${this.#configuration.indexPath}`;
    const bytes = await this.#request(
      url,
      INDEX_CONTENT_TYPE,
      MAX_COMMUNITY_REGISTRY_INDEX_BYTES,
    );
    return this.indexFromCache(bytes, minimumPublicationSequence, now);
  }

  async indexFromCache(
    bytes: string | Uint8Array,
    minimumPublicationSequence: number,
    now: Date,
  ): Promise<CommunityRegistryIndex> {
    const verified = await verifyCommunityRegistryIndex(bytes, {
      expectedRegistryId: this.#configuration.registryId,
      publicKey: this.#configuration.publicKey,
      minimumPublicationSequence,
      now,
    });
    if (!verified.ok) throw new RegistryClientError("INDEX_REJECTED");
    return verified.index;
  }

  async pack(
    index: CommunityRegistryIndex,
    entry: CommunityRegistryPackEntry,
    now: Date,
  ): Promise<VerifiedCommunityPack> {
    if (
      index.registryId !== this.#configuration.registryId ||
      index.packs.find((candidate) => candidate === entry) === undefined
    ) {
      throw new RegistryClientError("BUNDLE_REJECTED");
    }
    if (entry.revocation.status !== "ACTIVE") {
      throw new RegistryClientError("PACK_REVOKED");
    }
    const attestationValid = await verifyRegistryAttestation(
      JSON.stringify(entry.attestation),
      {
        expectedRegistryId: this.#configuration.registryId,
        publicKey: this.#configuration.publicKey,
        now,
      },
    );
    if (!attestationValid) throw new RegistryClientError("BUNDLE_REJECTED");
    const url = new URL(entry.bundlePath, this.#configuration.origin);
    if (
      url.origin !== this.#configuration.origin ||
      url.pathname !== entry.bundlePath ||
      url.search !== "" ||
      url.hash !== ""
    ) {
      throw new RegistryClientError("BUNDLE_REJECTED");
    }
    const bytes = await this.#request(
      url.href,
      BUNDLE_CONTENT_TYPE,
      MAX_DECLARATIVE_BUNDLE_BYTES,
    );
    return this.verifyPackBytes(index, entry, bytes, now);
  }

  async verifyPackBytes(
    index: CommunityRegistryIndex,
    entry: CommunityRegistryPackEntry,
    bytes: string | Uint8Array,
    now: Date,
  ): Promise<VerifiedCommunityPack> {
    if (
      index.registryId !== this.#configuration.registryId ||
      !index.packs.some(
        (candidate) =>
          candidate.publisher === entry.publisher &&
          candidate.id === entry.id &&
          candidate.version === entry.version &&
          candidate.bundleDigest === entry.bundleDigest &&
          JSON.stringify(candidate) === JSON.stringify(entry),
      ) ||
      entry.revocation.status !== "ACTIVE"
    ) {
      throw new RegistryClientError("BUNDLE_REJECTED");
    }
    const attestationValid = await verifyRegistryAttestation(
      JSON.stringify(entry.attestation),
      {
        expectedRegistryId: this.#configuration.registryId,
        publicKey: this.#configuration.publicKey,
        now,
      },
    );
    if (!attestationValid) throw new RegistryClientError("BUNDLE_REJECTED");
    const verified = await verifyDeclarativePackBundle(bytes, {
      trustedPublicKey: entry.publisherKey,
      runtimeVersion: this.#runtime.runtimeVersion,
      bridgeProtocolVersion: this.#runtime.bridgeProtocolVersion,
    });
    if (!verified.ok || !entryMatchesBundle(entry, verified.bundle)) {
      throw new RegistryClientError("BUNDLE_REJECTED");
    }
    if (
      verified.bundle.registryAttestation !== undefined &&
      JSON.stringify(verified.bundle.registryAttestation) !==
        JSON.stringify(entry.attestation)
    ) {
      throw new RegistryClientError("BUNDLE_REJECTED");
    }
    return Object.freeze({
      bundle: verified.bundle,
      content: contentOf(verified.bundle),
      entry,
      indexSequence: index.publicationSequence,
    });
  }

  async #request(
    url: string,
    contentType: string,
    maximumBytes: number,
  ): Promise<Uint8Array> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await this.#fetch(url, {
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (
        !response.ok ||
        response.status !== 200 ||
        response.redirected ||
        response.url !== url ||
        response.headers.get("content-type") !== contentType
      ) {
        throw new RegistryClientError("NETWORK_REJECTED");
      }
      const declared = response.headers.get("content-length");
      if (
        declared !== null &&
        (!/^(?:0|[1-9]\d*)$/u.test(declared) || Number(declared) > maximumBytes)
      ) {
        throw new RegistryClientError("NETWORK_REJECTED");
      }
      const bytes = await readBoundedBody(response.body, maximumBytes);
      if (declared !== null && Number(declared) !== bytes.byteLength) {
        throw new RegistryClientError("NETWORK_REJECTED");
      }
      return bytes;
    } catch (error) {
      if (error instanceof RegistryClientError) throw error;
      throw new RegistryClientError("NETWORK_REJECTED");
    } finally {
      clearTimeout(timeout);
    }
  }
}

function validateConfiguration(value: CommunityRegistryConfiguration): void {
  let parsed: URL;
  try {
    parsed = new URL(value.origin);
  } catch {
    throw new TypeError("community registry configuration was rejected");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.origin !== value.origin ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    localOrIpHost(parsed.hostname) ||
    value.indexPath !== "/v1/index.json" ||
    !/^[a-z][a-z0-9.-]{1,63}$/u.test(value.registryId) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(value.publicKey)
  ) {
    throw new TypeError("community registry configuration was rejected");
  }
}

function localOrIpHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.includes(":") ||
    /^\d+(?:\.\d+){3}$/u.test(hostname)
  );
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (body === null) throw new RegistryClientError("NETWORK_REJECTED");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      if (
        !(result.value instanceof Uint8Array) ||
        result.value.byteLength === 0
      ) {
        throw new RegistryClientError("NETWORK_REJECTED");
      }
      length += result.value.byteLength;
      if (length > maximumBytes) {
        throw new RegistryClientError("NETWORK_REJECTED");
      }
      chunks.push(result.value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  if (length === 0) throw new RegistryClientError("NETWORK_REJECTED");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function entryMatchesBundle(
  entry: CommunityRegistryPackEntry,
  bundle: DeclarativePackBundle,
): boolean {
  const manifest = bundle.manifest;
  const origins = [
    ...new Set(manifest.matches.map((match) => match.origin)),
  ].sort();
  const tools = manifest.tools
    .map((tool) => ({
      name: tool.name,
      ...(tool.title === undefined ? {} : { title: tool.title }),
      description: tool.description,
      risk: tool.risk,
      permissions: tool.permissions,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  return (
    entry.publisher === manifest.publisher &&
    entry.id === manifest.id &&
    entry.name === manifest.name &&
    entry.description === manifest.description &&
    entry.version === manifest.version &&
    entry.bundleDigest === manifest.digest &&
    entry.publisherKey === bundle.publisherSignature.publicKey &&
    JSON.stringify(entry.origins) === JSON.stringify(origins) &&
    JSON.stringify(entry.tools) === JSON.stringify(tools) &&
    entry.compatibility.runtime.minimum ===
      manifest.compatibility.runtime.minimum &&
    entry.compatibility.runtime.maximumExclusive ===
      manifest.compatibility.runtime.maximumExclusive &&
    entry.compatibility.bridgeProtocol.minimum ===
      manifest.compatibility.bridgeProtocol.minimum &&
    entry.compatibility.bridgeProtocol.maximum ===
      manifest.compatibility.bridgeProtocol.maximum &&
    entry.networkPolicy.extensionRequests ===
      manifest.networkPolicy.extensionRequests &&
    entry.verification.sourceCommit === bundle.metadata.sourceCommit
  );
}

function contentOf(
  bundle: DeclarativePackBundle,
): DeclarativePackBundleContent {
  return Object.freeze({
    bundleVersion: bundle.bundleVersion,
    manifest: bundle.manifest,
    operations: bundle.operations,
    metadata: bundle.metadata,
  });
}
