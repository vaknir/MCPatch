import { describe, expect, it, vi } from "vitest";

import {
  removeNavigationPrimitives,
  type NavigableRealm,
} from "../src/realm-navigation.js";

function realm(): { realm: NavigableRealm; assigned: string[] } {
  const assigned: string[] = [];
  const locationPrototype = {
    assign(url: string) {
      assigned.push(url);
    },
    replace(url: string) {
      assigned.push(url);
    },
  };
  Object.defineProperty(locationPrototype, "href", {
    configurable: true,
    enumerable: true,
    get() {
      return "https://shop.example/current";
    },
    set(url: string) {
      assigned.push(url);
    },
  });
  const formPrototype = {
    submit() {},
    requestSubmit() {},
  };
  return {
    realm: {
      open: vi.fn(),
      HTMLFormElement: { prototype: formPrototype },
      Location: { prototype: locationPrototype },
    },
    assigned,
  };
}

describe("realm navigation lockdown", () => {
  it("removes every ambient way a pack could navigate", () => {
    const { realm: r, assigned } = realm();
    removeNavigationPrimitives(r);

    const location = r.Location?.prototype as {
      assign: (url: string) => void;
      replace: (url: string) => void;
      href: string;
    };
    expect(() => location.assign("https://shop.example/a")).toThrow(
      /not available/,
    );
    expect(() => location.replace("https://shop.example/a")).toThrow(
      /not available/,
    );
    expect(() => {
      location.href = "https://shop.example/a";
    }).toThrow(/not available/);
    expect(() => (r.open as () => unknown)()).toThrow(/not available/);

    const form = r.HTMLFormElement?.prototype as {
      submit: () => void;
      requestSubmit: () => void;
    };
    expect(() => form.submit()).toThrow(/not available/);
    expect(() => form.requestSubmit()).toThrow(/not available/);

    expect(assigned).toEqual([]);
  });

  it("keeps reading the current URL working", () => {
    const { realm: r } = realm();
    removeNavigationPrimitives(r);
    const location = r.Location?.prototype as { href: string };
    expect(location.href).toBe("https://shop.example/current");
  });

  it("returns a frozen captured entry point for the action gate", () => {
    const { realm: r } = realm();
    const navigation = removeNavigationPrimitives(r);
    expect(typeof navigation.assign).toBe("function");
    expect(Object.isFrozen(navigation)).toBe(true);
  });

  it("captures Chromium's unforgeable own Location operation", () => {
    const assigned: string[] = [];
    const location = {};
    Object.defineProperties(location, {
      assign: {
        configurable: false,
        enumerable: true,
        writable: false,
        value(url: string) {
          assigned.push(url);
        },
      },
      href: {
        configurable: false,
        enumerable: true,
        get() {
          return "https://shop.example/current";
        },
        set(url: string) {
          void url;
        },
      },
      replace: {
        configurable: false,
        enumerable: true,
        writable: false,
        value(url: string) {
          void url;
        },
      },
    });
    const navigation = removeNavigationPrimitives({
      Location: { prototype: {} },
      location,
    });

    expect(() =>
      navigation.assign("https://shop.example/approved"),
    ).not.toThrow();
    expect(assigned).toEqual(["https://shop.example/approved"]);
  });

  it("installs stubs that survive delete and redefine", () => {
    const { realm: r } = realm();
    removeNavigationPrimitives(r);
    const prototype = r.Location?.prototype as object;
    expect(() =>
      Object.defineProperty(prototype, "assign", { value: () => {} }),
    ).toThrow(TypeError);
    expect(() =>
      Object.defineProperty(prototype, "href", { value: "x" }),
    ).toThrow(TypeError);
  });

  it("fails closed when the realm cannot navigate at all", () => {
    expect(() => removeNavigationPrimitives({})).toThrow(/no Location/);
    expect(() =>
      removeNavigationPrimitives({ Location: { prototype: {} } }),
    ).toThrow(/cannot navigate/);
  });
});
