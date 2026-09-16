import { contentScriptMatches } from "./content-script-matches.js";
import {
  CONTENT_SCRIPT_FILE,
  type ChromeRegisteredContentScript,
  type ChromeScriptingApi,
} from "./enablement-model.js";
import type { ValidatedLocalPack } from "./local-pack-model.js";

const LOCAL_REGISTRATION_PREFIX = "mcpatch-local-v1-";

export async function reconcileLocalContentScripts(
  scripting: ChromeScriptingApi,
  packs: readonly ValidatedLocalPack[],
): Promise<void> {
  const desired = localRegistrations(packs);
  const current = await scripting.getRegisteredContentScripts();
  const managed = current.filter((script) =>
    script.id.startsWith(LOCAL_REGISTRATION_PREFIX),
  );
  const remove = managed
    .filter((script) => {
      const expected = desired.get(script.id);
      return expected === undefined || !sameRegistration(script, expected);
    })
    .map((script) => script.id)
    .sort();
  if (remove.length > 0) {
    await scripting.unregisterContentScripts({ ids: remove });
  }
  const retained = new Set(
    managed
      .filter((script) => !remove.includes(script.id))
      .map((script) => script.id),
  );
  const add = [...desired.values()].filter(
    (script) => !retained.has(script.id),
  );
  if (add.length > 0) await scripting.registerContentScripts(add);
}

function localRegistrations(
  packs: readonly ValidatedLocalPack[],
): ReadonlyMap<string, ChromeRegisteredContentScript> {
  const origins = new Map<string, Set<string>>();
  for (const pack of packs) {
    for (const match of pack.manifest.matches) {
      const patterns = origins.get(match.origin) ?? new Set<string>();
      for (const pattern of contentScriptMatches(match)) patterns.add(pattern);
      origins.set(match.origin, patterns);
    }
  }
  return new Map(
    [...origins]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([origin, patterns]) => [
        localRegistrationId(origin),
        Object.freeze({
          id: localRegistrationId(origin),
          matches: Object.freeze([...patterns].sort()),
          js: Object.freeze([CONTENT_SCRIPT_FILE]),
          allFrames: false as const,
          persistAcrossSessions: true as const,
          runAt: "document_start" as const,
          world: "ISOLATED" as const,
        }),
      ]),
  );
}

function localRegistrationId(origin: string): string {
  const encoded = [...new TextEncoder().encode(origin)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${LOCAL_REGISTRATION_PREFIX}${encoded}`;
}

function sameRegistration(
  left: ChromeRegisteredContentScript,
  right: ChromeRegisteredContentScript,
): boolean {
  return (
    left.id === right.id &&
    left.allFrames === right.allFrames &&
    left.persistAcrossSessions === right.persistAcrossSessions &&
    left.runAt === right.runAt &&
    left.world === right.world &&
    JSON.stringify([...left.matches].sort()) ===
      JSON.stringify([...right.matches].sort()) &&
    left.js.length === 1 &&
    left.js[0] === CONTENT_SCRIPT_FILE
  );
}
