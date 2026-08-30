import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { canonical } from "../src/canonical.js";
import { buildRecord } from "../src/record.js";
import { CountersignBook } from "../src/countersign-book.js";
import { newOperatorKeyBase64, operatorSigner } from "../src/operator-key.js";

/**
 * The standalone verifier duplicates this package's hashing on purpose, so that
 * a record can be checked without the code that produced it. Independence is
 * the point: a verifier sharing a canonicaliser with the writer would cancel
 * out a bug in it and pass a record nobody else could reproduce.
 *
 * The hazard `canonical.ts` warns about is real all the same -- two
 * canonicalisers that drift apart make a chain check that quietly accepts
 * altered records, which is worse than no check. So the copies are pinned to
 * each other here: independent at runtime, and unable to diverge in silence.
 */

const script = readFileSync(
  fileURLToPath(new URL("../../../scripts/verify-record.mjs", import.meta.url)),
  "utf8",
);

/** The script's own canonicaliser, lifted out and run against this one. */
async function scriptCanonical(): Promise<(value: unknown) => string> {
  const source = script.slice(
    script.indexOf("function canonical(value) {"),
    script.indexOf("const sha256 ="),
  );
  expect(source, "canonical() not found in verify-record.mjs").toContain("sort");

  const module = await import(
    `data:text/javascript,${encodeURIComponent(`${source}\nexport { canonical };`)}`
  );
  return module.canonical as (value: unknown) => string;
}

describe("the standalone verifier hashes the same way this package does", () => {
  it("agrees on every shape a record entry can hold", async () => {
    const theirs = await scriptCanonical();

    const cases: unknown[] = [
      null,
      0,
      -1,
      1.5,
      "",
      "a string",
      true,
      false,
      [],
      {},
      [1, "two", null, { b: 1, a: 2 }],
      // Key order is the whole reason canonicalisation exists: these two must
      // produce identical output.
      { a: 1, b: 2 },
      { b: 2, a: 1 },
      { nested: { z: [1, 2], a: { deep: "value" } } },
      { undefinedIsDropped: undefined, kept: 1 },
      { "key with spaces": 1, "quote\"inside": 2 },
      { unicode: "café · 🛰️" },
      { at: 1_787_712_200_936, sequence: 12, event: { type: "world" } },
    ];

    for (const value of cases) {
      expect(theirs(value), `disagreed on ${JSON.stringify(value)}`).toBe(canonical(value));
    }
  });

  it("produces the same chain hash for a real entry", async () => {
    const theirs = await scriptCanonical();
    const sha256 = (input: string) => createHash("sha256").update(input).digest("hex");

    const entry = {
      previous: "a".repeat(64),
      sequence: 7,
      at: 1_787_712_200_936,
      event: { type: "world", event: { type: "gate.raised", office: "charge.refund" } },
    };

    expect(sha256(theirs(entry))).toBe(sha256(canonical(entry)));
  });
});

/**
 * The failure paths, exercised rather than read.
 *
 * These used to assert that certain strings appeared in the script's source,
 * which would have passed just as happily against validation that was broken,
 * unreachable, or commented out. The only way to know a verifier refuses a bad
 * record is to hand it one.
 */
describe("the verifier refuses records it should refuse", () => {
  const script = fileURLToPath(new URL("../../../scripts/verify-record.mjs", import.meta.url));

  function run(record: unknown, publicKeyPem?: string): { code: number; out: string } {
    const file = join(mkdtempSync(join(tmpdir(), "scope-verify-")), "record.json");
    writeFileSync(file, JSON.stringify(record));
    const result = spawnSync(process.execPath, [script, file], {
      encoding: "utf8",
      env: publicKeyPem
        ? { ...process.env, SCOPE_OPERATOR_PUBLIC_KEY: publicKeyPem }
        : process.env,
    });
    return { code: result.status ?? -1, out: `${result.stdout}${result.stderr}` };
  }

  /** A minimal record whose chain actually checks out. */
  function sound() {
    const scope = { scopeId: "SC-1", job: "do the thing", offices: ["charge.get"] };
    const missionId = "m_" + "a".repeat(10);
    let previous = createHash("sha256")
      .update(canonical({ missionId, scopeId: scope.scopeId, scope }))
      .digest("hex");

    const entries = [{ sequence: 1, at: 1, event: { type: "mission.status", status: "completed" } }].map(
      (entry) => {
        const hash = createHash("sha256")
          .update(canonical({ previous, sequence: entry.sequence, at: entry.at, event: entry.event }))
          .digest("hex");
        previous = hash;
        return { ...entry, hash };
      },
    );

    return { missionId, scopeId: scope.scopeId, job: scope.job, scope, entries, head: previous, algorithm: "sha256", lossy: false };
  }

  /**
   * A record with a real approval, signed, whose chain checks out.
   *
   * `signedGate` takes the arguments the gate was raised with separately from
   * the ones the signature covers, so a test can hand it a record where a
   * genuine signature sits beside a call it never authorised. That is the whole
   * attack: the chain stays intact, the signature stays real, and only an
   * independently derived fingerprint catches it.
   */
  function signedGate(params: { readonly signedArgs: Record<string, unknown>; readonly raisedArgs: Record<string, unknown> }) {
    const { signer } = operatorSigner(newOperatorKeyBase64());
    const scope = {
      missionId: "m_" + "b".repeat(10),
      scopeId: "SC-SIGN",
      agent: "a",
      job: "Refund order 184",
      state: "granted",
      offices: ["charge.refund"],
      resources: { charge_ids: ["ch_184"] },
      limits: { maxAmountMinor: { "charge.refund": 4900 }, maxCalls: {}, maxResponseBytes: 64_000 },
      projection: {},
      countersignRequired: ["charge.refund"],
      expiresAt: 2_000_000_000_000,
      grantedBy: "operator:test",
      grantedAt: 1,
      version: 1,
    } as unknown as Parameters<typeof CountersignBook.prototype.raise>[0]["scope"];

    const book = new CountersignBook(signer);
    const raised = book.raise({
      scope,
      toolCallId: "c1",
      threadId: "main",
      office: "charge.refund",
      args: params.signedArgs,
      now: 1,
    });
    book.settle("c1", { status: "approved", at: 2 });
    const signature = book.signatureFor("c1")!;

    const world = [
      { type: "gate.raised", threadId: "main", toolCallId: "c1", office: "charge.refund", args: params.raisedArgs, at: 1 },
      {
        type: "gate.cleared",
        toolCallId: "c1",
        approved: true,
        signature: signature.signature,
        operator: signature.operator,
        algorithm: signature.algorithm,
        fingerprint: raised.fingerprint,
        at: 2,
      },
    ];

    const record = buildRecord({
      missionId: scope.missionId,
      scope,
      events: world.map((w, i) => ({ sequence: i + 1, at: w.at, event: { type: "world", event: w } })) as never,
      startedAt: 1,
      finishedAt: 3,
    });

    return { record, publicKeyPem: signer.publicKeyPem };
  }

  it("reports a signed approval as signed but unverified without the key", () => {
    // Seeing a signature and checking one are different things, and reporting
    // the first as the second would be the whole point thrown away.
    const { record } = signedGate({
      signedArgs: { charge_id: "ch_184", amount_minor: 4900 },
      raisedArgs: { charge_id: "ch_184", amount_minor: 4900 },
    });

    const { code, out } = run(record);
    expect(code, out).toBe(0);
    expect(out).toContain("signed, unverified");
  });

  it("refuses a real signature paired with a rewritten call", () => {
    /*
     * The attack the fingerprint derivation exists for.
     *
     * Everything here is genuine except the pairing: the signature was really
     * made by the operator, the chain really covers the entries, and the
     * `fingerprint` field really is the one that was signed. Only the call it
     * sits beside was changed, from a 49-dollar refund to a 3,990-dollar one.
     *
     * A verifier that checked the signature against the fingerprint written in
     * the record would pass this and print `signature valid`, which is why the
     * fingerprint is recomputed from the raised gate and the sealed scope.
     */
    const { record, publicKeyPem } = signedGate({
      signedArgs: { charge_id: "ch_184", amount_minor: 4900 },
      raisedArgs: { charge_id: "ch_999", amount_minor: 399_000 },
    });

    const { out } = run(record, publicKeyPem);
    expect(out, "the chain is intact, which is the point").toContain("chain intact");
    expect(out).toContain("SIGNATURE INVALID");
    expect(out).toContain("does not describe the call it answers");
  });

  it("verifies a signature that does describe its call", () => {
    const { record, publicKeyPem } = signedGate({
      signedArgs: { charge_id: "ch_184", amount_minor: 4900 },
      raisedArgs: { charge_id: "ch_184", amount_minor: 4900 },
    });

    const { code, out } = run(record, publicKeyPem);
    expect(code, out).toBe(0);
    expect(out).toContain("signature valid");
  });

  it("accepts a sound record", () => {
    const { code, out } = run(sound());
    expect(code, out).toBe(0);
    expect(out).toContain("chain intact");
  });

  it("rejects an altered entry and names it", () => {
    const record = sound();
    record.entries[0]!.event = { type: "mission.status", status: "failed" };

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("does not match the chain");
  });

  it("rejects a head that does not match, which is how truncation shows", () => {
    const record = sound();
    record.head = "0".repeat(64);

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("head does not match");
  });

  it("refuses a lossy record instead of calling an intact chain complete", () => {
    const record = sound();
    record.lossy = true;

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("not a complete history");
  });

  it("refuses an algorithm it does not implement rather than checking a different one", () => {
    const record = sound();
    record.algorithm = "sha512";

    const { code, out } = run(record);
    expect(code).toBe(1);
    expect(out).toContain("only checks sha256");
  });

  it("accepts an empty record whose head is the genesis hash", () => {
    // A scope sealed and nothing done: denied at the grant screen, or cancelled
    // while still proposed. Refusing that reported a legitimate record as
    // broken, and made "nothing happened" indistinguishable from "somebody
    // removed everything" -- which the head check already tells apart.
    const scope = { scopeId: "SC-EMPTY", job: "denied before anything ran", offices: [] };
    const missionId = "m_" + "c".repeat(10);
    const head = createHash("sha256")
      .update(canonical({ missionId, scopeId: scope.scopeId, scope }))
      .digest("hex");

    const { code, out } = run({
      missionId,
      scopeId: scope.scopeId,
      job: scope.job,
      scope,
      entries: [],
      head,
      algorithm: "sha256",
      lossy: false,
    });

    expect(code, out).toBe(0);
    expect(out).toContain("chain intact");
  });

  it("still refuses an empty record whose head claims entries once existed", () => {
    // The other half. Emptying the entries and leaving the head is exactly the
    // tampering the head exists to catch, and must not be waved through as an
    // ordinary empty record.
    const { code, out } = run({ ...sound(), entries: [] });

    expect(code).toBe(1);
    expect(out).toContain("head does not match");
  });

  it("refuses a record with no entries array at all", () => {
    const { code, out } = run({ ...sound(), entries: undefined });

    expect(code).toBe(1);
    expect(out).toContain("no entries array");
  });

  it("reports the sealed job, not the loose one, and says when they differ", () => {
    // The top-level copy sits outside the chain. Printing it as though the
    // chain covered it would attest to a field nothing attests to.
    const record = sound();
    record.job = "something else entirely";

    const { code, out } = run(record);
    expect(code).toBe(0);
    expect(out).toContain("do the thing");
    expect(out).toContain("disagrees with the sealed scope");
  });

  it("counts a raised gate with no clear as unanswered", () => {
    // The explicit `gate.abandoned` event only exists in records written after
    // it did. A gate raised and never cleared is the same fact, structurally.
    const scope = { scopeId: "SC-1", job: "j", offices: [] };
    const missionId = "m_" + "b".repeat(10);
    let previous = createHash("sha256")
      .update(canonical({ missionId, scopeId: scope.scopeId, scope }))
      .digest("hex");

    const raw = [
      { sequence: 1, at: 1, event: { type: "world", event: { type: "gate.raised", threadId: "main", toolCallId: "tc_1", office: "charge.refund", args: {}, at: 1 } } },
      { sequence: 2, at: 2, event: { type: "mission.status", status: "cancelled" } },
    ];
    const entries = raw.map((entry) => {
      const hash = createHash("sha256")
        .update(canonical({ previous, sequence: entry.sequence, at: entry.at, event: entry.event }))
        .digest("hex");
      previous = hash;
      return { ...entry, hash };
    });

    const { code, out } = run({ missionId, scopeId: scope.scopeId, job: scope.job, scope, entries, head: previous, algorithm: "sha256", lossy: false });

    expect(code, out).toBe(0);
    expect(out).toMatch(/left unanswered\s+1/);
  });
});
