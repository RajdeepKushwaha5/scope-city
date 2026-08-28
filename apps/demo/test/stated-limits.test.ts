import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The README says plainly what this is not yet: a static key at the proxy,
 * missions in memory, six fixed districts, no operator identity.
 *
 * Those are the most useful sentences in it and the easiest to let rot. If one
 * of them gets fixed, the claim becomes a lie in the opposite direction --
 * understating the system rather than overstating it -- and nobody notices,
 * because nobody re-reads a limitations list looking for good news.
 */
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, root)), "utf8");

const readme = read("README.md");
const limits = readme.slice(
  readme.indexOf("## Where this goes"),
  readme.indexOf("## Qodo Code Review Evidence"),
);

describe("the stated limits are still true", () => {
  it("says the proxy holds a static key, and it does", () => {
    const systems = read("apps/demo/src/systems.ts");

    expect(limits).toContain("static key");
    expect(systems).toContain("process.env.STRIPE_API_KEY");
  });

  it("says six districts, and there are six", () => {
    const world = read("apps/city/src/render/world.ts");
    const plots = world.slice(world.indexOf("DISTRICT_PLOTS"), world.indexOf("];", world.indexOf("DISTRICT_PLOTS")));

    expect((plots.match(/id: "/g) ?? []).length).toBe(6);
    expect(limits).toContain("six districts");
  });

  it("says buildings are generated, and they are", () => {
    // The distinction the section draws: buildings come from the office list,
    // districts are hand-placed. Claiming the first would be wrong if the
    // layout were authored.
    const scene = read("apps/city/src/render/scene.ts");

    expect(scene).toContain("export function cityFor(offices");
    expect(limits).toContain("Buildings are generated");
  });

  it("says missions live in memory, and the docs agree", () => {
    // Whitespace collapsed before matching: the doc wraps this phrase across a
    // line break, and asserting the exact wrapping would fail on a reflow that
    // changed nothing about the meaning.
    const flat = read("docs/TRUEFORGE.md").replace(/\s+/g, " ");

    expect(limits).toContain("live in memory");
    expect(flat).toContain("held in memory");
  });

  it("does not claim anything the project has not built", () => {
    // The enterprise wishlist this section grew out of -- Vault, OPA, SIEM
    // export, tenancy -- is named as what would come next, never as what is
    // here. A limitations section that drifts into a feature list is worse
    // than none.
    for (const claim of ["Vault", "STS", "workload identity"]) {
      const at = limits.indexOf(claim);
      if (at === -1) continue;
      const sentence = limits.slice(Math.max(0, at - 200), at + 100);
      expect(sentence, `${claim} must read as future work`).toMatch(/honest fix|would|could|next/i);
    }
  });
});
