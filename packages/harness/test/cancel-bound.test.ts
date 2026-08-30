import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A cancel is what a caller does after it has given up waiting.
 *
 * The SDK's default request timeout is 600 seconds, which is right for a turn
 * and wrong for this: the caller is usually in a cleanup path with a proxy and
 * a token-bearing subprocess still open behind it. Racing a timer around the
 * `await` only stops the waiting -- the request stays live under the client's
 * own timeout -- so the bound has to reach the request itself.
 */
describe("bounding a cancel", () => {
  const driver = readFileSync(
    fileURLToPath(new URL("../src/driver.ts", import.meta.url)),
    "utf8",
  );

  it("passes the caller's bound into the request", () => {
    // Not a timer wrapped around the call: that leaves the request running.
    expect(driver).toContain("timeoutInSeconds: timeoutSeconds");
  });

  it("still lets a caller take the client's default", () => {
    // Every other caller wants the default, and a mandatory bound would make
    // each of them invent a number.
    expect(driver).toMatch(/cancel\(sessionId: string, timeoutSeconds\?: number\)/);
    expect(driver).toContain("timeoutSeconds === undefined ? undefined :");
  });
});
