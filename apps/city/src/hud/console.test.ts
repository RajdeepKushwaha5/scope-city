import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { EFFORT_LEVELS, effortSpriteUrl } from "./CrewModal.js";

/**
 * The operator console: the panel a judge reads while the demo runs.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const console_ = read("./CityConsole.tsx");
const app = read("../App.tsx");
const order = read("./MissionOrder.tsx");
const view = read("../city-view.ts");
const css = read("./hud.css");

describe("the crew portrait", () => {
  it("uses the artwork that has been in the repo all along", () => {
    // The console drew a 10x9px tan rectangle for a head and a 14x15px blue one
    // for a body. It was not that the portrait was missing -- it was a
    // placeholder that outlived the asset it stood in for, and the asset was
    // sitting in `public/crew` being used by the panel on the other side of the
    // screen.
    expect(console_).toContain("effortSpriteUrl(props.crew ?? \"medium\")");
    expect(console_, "the placeholder boxes are still being drawn").not.toContain(
      "crew-card__head",
    );
  });

  it("has a file behind every crew it can show", () => {
    for (const level of EFFORT_LEVELS) {
      const url = effortSpriteUrl(level);
      const file = fileURLToPath(new URL(`../../public${url.replace(/^\/?/, "/")}`, import.meta.url));
      expect(existsSync(file), `${url} has no file`).toBe(true);
    }
  });

  it("drops the rules that scaled the boxes", () => {
    // Dead CSS positioning a sprite that no longer exists is the kind of thing
    // that gets copied into the next panel.
    expect(css).not.toContain(".console__portrait .crew-card__head");
  });
});

describe("who is on duty", () => {
  it("is decided in one place", () => {
    // It was local state inside `MissionOrder`, and the console drew its own
    // portrait from a placeholder -- so the two panels could not have agreed
    // even in principle about who was on duty.
    expect(app).toMatch(/useState<EffortLevel>\("medium"\)/);
    expect(order, "the order panel must not keep its own copy").not.toMatch(
      /useState<EffortLevel>/,
    );
  });

  it("reaches both panels from there", () => {
    expect(app).toContain("effort={effort}");
    expect(app).toContain("onEffort={setEffort}");
  });
});

describe("whose run the console is describing", () => {
  it("does not caption a replay with the launch form's setting", () => {
    // The bug this PR introduced and the review caught. A recorded run carries
    // no effort metadata at all, and the console was handed the picker's
    // current value -- so it labelled somebody else's captured session "Medium
    // effort", and the operator could change that label while it played.
    expect(app).toContain("crew={live.active ? dispatched : replaying ? null : effort}");
    expect(console_).toContain('"effort not recorded"');
  });

  it("reports the effort a live mission was dispatched with, not the current pick", () => {
    // The picker is a form and this is a fact about a run. They diverge the
    // moment the operator touches the control after dispatching.
    expect(app).toContain("setDispatched(level)");
    expect(app).toMatch(/const \[dispatched, setDispatched\] = useState<EffortLevel \| null>/);
  });

  it("locks the picker while a replay is on screen", () => {
    // It was gated on `live.active` alone, so it stayed editable during a
    // recording -- and the console was reading it.
    expect(app).toContain("active={live.active || replaying}");
  });

  it("says which of the two it is showing", () => {
    // "Medium effort" and "Medium effort selected" are different claims.
    expect(console_).toContain('props.crewIsRunning ? "" : " selected"');
  });
});

describe("what the console claims to know", () => {
  it("does not report a spend nothing is measuring", () => {
    // The live view returned a hard-coded `0` for this, so a real mission
    // displayed "Treasury $0.0000" for its whole run beside figures that were
    // genuinely live. A constant dressed as a reading is the exact thing this
    // project spends its argument objecting to, and it was in the operator's
    // own console.
    expect(view).toMatch(/treasury: null,/);
    expect(view).toMatch(/readonly treasury: number \| null;/);
  });

  it("says so in words rather than with a zero", () => {
    expect(console_).toContain('"not metered"');
  });

  it("counts money in whole units", () => {
    // Every other monetary value in this codebase is an integer in minor units,
    // because the evaluator compares amounts and cannot afford drift. There is
    // no reason for two rules about money in one project, and the accumulator
    // here was floating-point dollars rounded back to four places on every
    // addition -- the pattern those rules exist to refuse.
    const mission = read("../useMission.ts");
    expect(mission).toMatch(/spend: \(units\) => setTreasury\(\(t\) => t \+ Math\.max\(0, Math\.round\(units\)\)\)/);
    expect(mission, "a fractional literal is how it drifted before").toMatch(
      /export const SPEND_PER_TURN = \d+;/,
    );
    expect(console_, "converted only for display").toContain("/ 10_000");
  });

  it("calls it what it is", () => {
    // "Treasury" reads as a balance you draw down. This is what the model cost.
    expect(console_).toContain('label="Model spend"');
    expect(console_).not.toContain('label="Treasury"');
  });
});

describe("the title bar controls", () => {
  it("does not put a cross where a close button would be", () => {
    // The mute control was a play triangle and a cross. A cross in the corner
    // of a panel is the control that closes it, so the first icon in the
    // console's title bar read as "close the console" -- and the state it was
    // reporting was the opposite of the one people assumed.
    const bar = console_.slice(console_.indexOf("right={"), console_.indexOf("</Window>"));
    expect(bar).not.toContain('"✖"');
    expect(bar).toContain("window__icon--off");
  });

  it("shows the muted state as a struck-through glyph", () => {
    expect(css).toContain(".window__icon--off::after");
  });
});
