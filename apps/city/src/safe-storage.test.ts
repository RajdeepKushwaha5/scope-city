import { afterEach, describe, expect, it, vi } from "vitest";
import { readSetting, writeSetting } from "./safe-storage.js";

/**
 * Reading storage is not merely unavailable in some browsers, it *throws*.
 * Safari in private browsing, Chrome with site data blocked, and most embedded
 * webviews raise on the property access itself -- and the calls were happening
 * in a module-level constructor and a `useState` initialiser, so the throw
 * landed during import and first render. That is a white screen with no error
 * a visitor can see, on the one URL a judge opens.
 */
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.unstubAllGlobals();
});

/** A browser that refuses storage by throwing on access. */
function blockStorage(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage is disabled");
    },
  });
}

describe("readSetting", () => {
  it("returns null rather than throwing when storage is blocked", () => {
    blockStorage();
    expect(() => readSetting("anything")).not.toThrow();
    expect(readSetting("anything")).toBeNull();
  });

  it("returns null when the key was never set", () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined });
    expect(readSetting("missing")).toBeNull();
  });

  it("returns the stored value when storage works", () => {
    vi.stubGlobal("localStorage", { getItem: () => "true", setItem: () => undefined });
    expect(readSetting("k")).toBe("true");
  });

  it("survives an environment with no localStorage at all", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(readSetting("k")).toBeNull();
  });
});

describe("writeSetting", () => {
  it("does not throw when storage is blocked", () => {
    blockStorage();
    expect(() => writeSetting("k", "v")).not.toThrow();
  });

  it("does not throw when the quota is full", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    });
    expect(() => writeSetting("k", "v")).not.toThrow();
  });

  it("writes when storage works", () => {
    const written: [string, string][] = [];
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: (k: string, v: string) => written.push([k, v]),
    });
    writeSetting("k", "v");
    expect(written).toEqual([["k", "v"]]);
  });
});
