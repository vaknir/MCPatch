import { describe, expect, it, vi } from "vitest";

import { DeclarativeNavigationCoordinator } from "../src/declarative-navigation-coordinator.js";
import { FIXTURE_ORIGIN } from "../e2e/fixture-constants.js";
import { fixtureLocalBundle } from "../e2e/fixture-local-bundle.js";

describe("declarative navigation coordinator", () => {
  it("revokes the old context before one deferred same-pack navigation", () => {
    const events: string[] = [];
    const deferred: Array<() => void> = [];
    const coordinator = new DeclarativeNavigationCoordinator(
      fixtureLocalBundle.manifest,
      { assign: (url) => events.push(`navigate:${url}`) },
      (run) => deferred.push(run),
    );
    coordinator.bindContextRevocation(() => events.push("revoke"));
    const destination = `${FIXTURE_ORIGIN}/items/next`;
    coordinator.schedule(destination, new AbortController().signal);

    expect(events).toEqual([]);
    expect(deferred).toHaveLength(1);
    deferred[0]?.();
    expect(events).toEqual(["revoke", `navigate:${destination}`]);
  });

  it("cancels before the deferred attempt and rejects an unmatched target", () => {
    const assign = vi.fn();
    const revoke = vi.fn();
    let deferred: (() => void) | undefined;
    const coordinator = new DeclarativeNavigationCoordinator(
      fixtureLocalBundle.manifest,
      { assign },
      (run) => {
        deferred = run;
      },
    );
    coordinator.bindContextRevocation(revoke);
    const controller = new AbortController();
    coordinator.schedule(`${FIXTURE_ORIGIN}/items/next`, controller.signal);
    controller.abort();
    deferred?.();
    expect(revoke).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(() =>
      coordinator.schedule(
        "https://attacker.example/items/next",
        new AbortController().signal,
      ),
    ).toThrow(/outside/u);
  });
});
