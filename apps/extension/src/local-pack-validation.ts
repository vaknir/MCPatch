import {
  computeDeclarativePackBundleDigest,
  packSupportsBridgeProtocol,
  packSupportsRuntime,
  type DeclarativePackBundleContent,
} from "@mcpatch/sdk/runtime";

import type { CompiledPackRuntimeOptions } from "./compiled-pack-validation.js";
import type {
  LocalPackRecord,
  LocalPackSummary,
  ValidatedLocalPack,
} from "./local-pack-model.js";
import { LOCAL_PACK_TRUST } from "./local-pack-model.js";
import { supportsRuntimeSchema } from "./runtime-schema.js";

export class LocalBundleError extends Error {
  readonly code: "DIGEST_MISMATCH" | "INCOMPATIBLE";

  constructor(code: LocalBundleError["code"]) {
    super(code);
    this.code = code;
  }
}

export async function validateLocalBundle(
  bundle: DeclarativePackBundleContent,
  runtime: CompiledPackRuntimeOptions,
): Promise<ValidatedLocalPack> {
  const digest = await computeDeclarativePackBundleDigest(bundle);
  if (digest !== bundle.manifest.digest) {
    throw new LocalBundleError("DIGEST_MISMATCH");
  }
  if (
    !packSupportsRuntime(bundle.manifest, runtime.runtimeVersion) ||
    !packSupportsBridgeProtocol(
      bundle.manifest,
      runtime.bridgeProtocolVersion,
    ) ||
    bundle.manifest.tools.some(
      (tool) =>
        tool.permissions.some(
          (permission) => !runtime.allowedPermissions.includes(permission),
        ) ||
        !supportsRuntimeSchema(tool.inputSchema) ||
        !supportsRuntimeSchema(tool.outputSchema),
    )
  ) {
    throw new LocalBundleError("INCOMPATIBLE");
  }
  const origins = Object.freeze(
    [...new Set(bundle.manifest.matches.map((match) => match.origin))].sort(),
  );
  return Object.freeze({ bundle, manifest: bundle.manifest, origins });
}

export function localPackIdentity(
  bundle: DeclarativePackBundleContent,
): string {
  return `${bundle.manifest.publisher}/${bundle.manifest.id}`;
}

export function permissionPatterns(
  origins: readonly string[],
): readonly string[] {
  return Object.freeze(origins.map((origin) => `${origin}/*`));
}

export function recordPermissionPatterns(
  record: LocalPackRecord,
): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        record.bundle.manifest.matches.map((match) => `${match.origin}/*`),
      ),
    ].sort(),
  );
}

export function summarizeLocalPack(
  pack: ValidatedLocalPack,
  enabled: boolean,
  installId?: string,
): LocalPackSummary {
  return Object.freeze({
    ...(installId === undefined ? {} : { installId }),
    publisher: pack.manifest.publisher,
    id: pack.manifest.id,
    name: pack.manifest.name,
    version: pack.manifest.version,
    digest: pack.manifest.digest,
    trust: LOCAL_PACK_TRUST,
    origins: pack.origins,
    tools: Object.freeze(
      pack.manifest.tools.map((tool) =>
        Object.freeze({
          name: tool.name,
          description: tool.description,
          risk: tool.risk,
          permissions: Object.freeze([...tool.permissions]),
        }),
      ),
    ),
    enabled,
  });
}

export function summarizeLocalRecord(
  record: LocalPackRecord,
): LocalPackSummary {
  const origins = Object.freeze(
    [
      ...new Set(record.bundle.manifest.matches.map((match) => match.origin)),
    ].sort(),
  );
  return summarizeLocalPack(
    Object.freeze({
      bundle: record.bundle,
      manifest: record.bundle.manifest,
      origins,
    }),
    record.enabled,
    record.installId,
  );
}
