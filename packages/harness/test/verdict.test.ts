import { describe, expect, it } from "vitest";
import { readVerdict, sandboxEnvelope } from "../src/verdict.js";
import { isSandboxOffice, scriptFrom } from "../src/translate.js";

describe("readVerdict", () => {
  it("accepts a clear pass", () => {
    for (const out of ["OK", "amounts match", "verified: 4900 == 4900", "PASSED"]) {
      expect(readVerdict(out)).toBe(true);
    }
  });

  it("refuses anything that reads as a failure", () => {
    for (const out of [
      "FAIL: amounts differ",
      "Traceback (most recent call last):",
      "AssertionError",
      "mismatch: 4900 vs 39900",
    ]) {
      expect(readVerdict(out)).toBe(false);
    }
  });

  it("treats an unreadable result as a failure", () => {
    // A verification whose result cannot be read is not a verification, and
    // defaulting to "probably fine" where a human is relying on the check
    // would be the worst possible default.
    for (const out of ["", "   ", "42", "done."]) {
      expect(readVerdict(out)).toBe(false);
    }
  });

  it("refuses output that says both, because failure wins", () => {
    // "ok" appearing somewhere does not cancel a traceback.
    expect(readVerdict("check ok\nAssertionError: amounts differ")).toBe(false);
  });
});

describe("readVerdict on a real sandbox envelope", () => {
  /** Captured verbatim from a live Daytona run. */
  const PASSED =
    '{"success":true,"response":{"exitCode":0,"result":"Verdict: Ready to refund.\n"}}';
  const FAILED =
    '{"success":true,"response":{"exitCode":2,"result":"/usr/bin/bash: line 2: amount_to_refund: command not found\n"}}';

  it("believes the exit code over the prose", () => {
    // This is the case that made the rule. The agent's check asserted, passed,
    // and printed "Verdict: Ready to refund." -- a sentence containing none of
    // the words a text matcher looks for. Reading prose first marked a
    // successful verification as failed and would have blocked every approval.
    expect(readVerdict(PASSED)).toBe(true);
  });

  it("fails a non-zero exit", () => {
    expect(readVerdict(FAILED)).toBe(false);
  });

  it("fails a zero exit that still reports a failure", () => {
    // A script can print FAIL and forget to exit non-zero.
    expect(
      readVerdict('{"response":{"exitCode":0,"result":"FAIL: amounts differ"}}'),
    ).toBe(false);
  });

  it("reads a flat envelope as well as a nested one", () => {
    expect(readVerdict('{"exitCode":0,"result":"done"}')).toBe(true);
  });

  it("falls through to text when there is no envelope", () => {
    expect(readVerdict("amounts match")).toBe(true);
    expect(readVerdict("AssertionError")).toBe(false);
  });
});

describe("sandboxEnvelope", () => {
  it("returns null for output that is not an envelope", () => {
    expect(sandboxEnvelope("plain text")).toBeNull();
    expect(sandboxEnvelope('{"no":"exit code"}')).toBeNull();
  });
});

describe("isSandboxOffice", () => {
  it("recognises sandbox execution", () => {
    for (const office of ["exec", "bash", "shell", "sandbox.exec"]) {
      expect(isSandboxOffice(office)).toBe(true);
    }
  });

  it("does not claim ordinary tools", () => {
    // A false positive would attach an unrelated tool's output to the gate as
    // though it were verification, which is worse than attaching nothing.
    for (const office of ["charge.refund", "mail.send", "ticket.get", "execute_order"]) {
      expect(isSandboxOffice(office)).toBe(false);
    }
  });
});

describe("scriptFrom", () => {
  it("finds the script under whichever argument name was used", () => {
    expect(scriptFrom({ script: "print(1)" })).toBe("print(1)");
    expect(scriptFrom({ code: "print(2)" })).toBe("print(2)");
    expect(scriptFrom({ command: "ls" })).toBe("ls");
  });

  it("accepts a bare string", () => {
    expect(scriptFrom("print(3)")).toBe("print(3)");
  });

  it("returns nothing rather than a guess", () => {
    // Showing the operator the wrong text next to a verdict is worse than
    // showing them none.
    expect(scriptFrom({ unrelated: "value" })).toBe("");
    expect(scriptFrom(null)).toBe("");
    expect(scriptFrom(42)).toBe("");
  });
});
