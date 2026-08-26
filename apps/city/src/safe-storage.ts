/**
 * `localStorage` that cannot take the page down with it.
 *
 * Reading storage is not merely unavailable in some browsers, it *throws*.
 * Safari in private browsing, Chrome with site data blocked, and most embedded
 * webviews raise a `SecurityError` on the property access itself. A
 * `typeof window !== "undefined"` guard does not help: that tests for a server,
 * and this is a browser refusing.
 *
 * That distinction matters because the calls were happening in a module-level
 * singleton's constructor and in a `useState` initialiser -- both of which run
 * during import or first render. A throw there is not a lost preference, it is
 * a white screen with no error a visitor can see, on the one URL a judge opens.
 *
 * Preferences are a convenience. Nothing here is worth failing a page load for,
 * so every path falls back to the default and carries on.
 */

export function readSetting(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage full, blocked, or private. The setting simply does not persist,
    // which is a smaller problem than the alternative.
  }
}
