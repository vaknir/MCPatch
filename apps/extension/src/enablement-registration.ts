import {
  CONTENT_SCRIPT_FILE,
  REGISTRATION_PREFIX,
  type ChromeRegisteredContentScript,
  type ChromeScriptingApi,
  type ReviewedPackSite,
} from "./enablement-model.js";

export async function reconcileContentScripts(
  scripting: ChromeScriptingApi,
  sites: readonly ReviewedPackSite[],
  effectiveSites: Iterable<ReviewedPackSite>,
  invalidateOrigin: (origin: string) => void,
): Promise<void> {
  const desired = new Map<string, ChromeRegisteredContentScript>();
  for (const site of sites)
    desired.set(site.registrationId, registrationFor(site));

  const current = await scripting.getRegisteredContentScripts();
  const managed = current.filter((script) =>
    script.id.startsWith(REGISTRATION_PREFIX),
  );
  if (new Set(managed.map((script) => script.id)).size !== managed.length) {
    throw new Error("duplicate managed content-script registration");
  }
  const remove = managed
    .filter((script) => {
      const expected = desired.get(script.id);
      return expected === undefined || !sameRegistration(script, expected);
    })
    .map((script) => script.id)
    .sort();
  if (remove.length > 0) {
    const affected = new Set(
      [...effectiveSites]
        .filter((site) => remove.includes(site.registrationId))
        .map((site) => site.origin),
    );
    for (const origin of affected) invalidateOrigin(origin);
    await scripting.unregisterContentScripts({ ids: remove });
  }
  const retained = new Set(
    managed
      .filter((script) => !remove.includes(script.id))
      .map((script) => script.id),
  );
  const add = [...desired.values()]
    .filter((script) => !retained.has(script.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (add.length > 0) await scripting.registerContentScripts(add);
}

export function registrationFor(
  site: ReviewedPackSite,
): ChromeRegisteredContentScript {
  return Object.freeze({
    id: site.registrationId,
    matches: Object.freeze([site.permissionPattern]),
    js: Object.freeze([CONTENT_SCRIPT_FILE]),
    allFrames: false,
    persistAcrossSessions: true,
    runAt: "document_start",
    world: "ISOLATED",
  });
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
    left.matches.length === 1 &&
    left.matches[0] === right.matches[0] &&
    left.js.length === 1 &&
    left.js[0] === right.js[0]
  );
}
