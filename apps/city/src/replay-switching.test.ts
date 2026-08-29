import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Switching between the two replay engines.
 *
 * There are two of them -- a scripted player and a recorded one -- writing to
 * different state, and the city renders whichever *holds a record*. That makes
 * switching between them a thing that has to be done deliberately, and every
 * defect here has been the same shape: one of them left running under the other,
 * so the operator picks a run and watches a different one.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const app = read("./App.tsx");
const recorded = read("./useRecordedMission.ts");
const mission = read("./useMission.ts");

const runScenario = app.slice(app.indexOf("const runScenario = useCallback"), app.indexOf("const commandItems"));

describe("starting the recording", () => {
  it("cancels the scripted player first", () => {
    // The scripted timers kept firing under the recording, landing their steps
    // on a city that was showing something else. Found by clicking the buttons
    // in a browser rather than by reading the diff -- both players were doing
    // exactly what their own code said.
    const reset = runScenario.indexOf("replay.reset()");
    const play = runScenario.indexOf("recorded.play(RECORDING_URL)");

    expect(reset, "the scripted player is never cancelled").toBeGreaterThan(-1);
    expect(play).toBeGreaterThan(-1);
    expect(reset, "it must be cancelled before the recording starts").toBeLessThan(play);
  });

  it("has something to cancel it with", () => {
    expect(mission, "`reset` is not exported from useMission").toMatch(/^\s{4}reset,$/m);
  });
});

describe("starting a script", () => {
  it("leaves the recording rather than pausing it", () => {
    // `stop` keeps the record, and the city renders the recorded view whenever
    // one is held -- so a scripted run started after `stop` ran underneath the
    // recording it thought it had replaced. The comment above that call
    // described the intended behaviour while the code did the opposite.
    expect(runScenario).toContain("recorded.leave()");
    expect(runScenario, "stop is a pause, not a switch").not.toContain("recorded.stop()");
  });

  it("has a leave that actually leaves", () => {
    // The distinction the bug turned on: pausing keeps the record, and holding
    // a record is what makes the recorded view win.
    const leave = recorded.slice(recorded.indexOf("const leave = useCallback"), recorded.indexOf("}, [stop]);"));
    expect(leave).toContain("stop()");
    expect(leave, "leaving must give up the record").toContain("setRecord(null)");
  });

  it("still offers a pause that keeps the record", () => {
    // `revoke` on a recorded replay stops playback and leaves the recording on
    // screen, which is right: there is nothing to decide about a past mission,
    // but there is still something to look at.
    expect(recorded).toMatch(/const stop = useCallback/);
    expect(app).toContain("revoke: recorded.stop");
  });
});
