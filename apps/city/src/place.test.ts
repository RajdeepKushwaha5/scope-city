import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DISTRICT_NOTES, describePlace, districtTitle } from "./place.js";
import { DISTRICT_PLOTS, layOutCity, type Building } from "./render/world.js";
import { OFFICES } from "./useMission.js";

/**
 * The complaint this answers, in the operator's words: the buildings do not do
 * anything. Nine of them did. The other two hundred and thirty swallowed the
 * pointer, and a map that ignores most of itself teaches you to stop trying the
 * parts that would have answered.
 */

const city = layOutCity(OFFICES);

const building = (over: Partial<Building>): Building => ({
  cell: { u: 4, v: 4 },
  height: 1,
  seed: 1,
  kind: "filler",
  district: null,
  office: null,
  ...over,
});

describe("what a building says about itself", () => {
  it("gives every structure in the city an answer", () => {
    // The assertion is over the real layout rather than a fixture, because the
    // bug was a property of the layout: the city draws far more than it
    // explains, and a test on three hand-made buildings would not have noticed.
    //
    // The floor is a floor, not a count. It was 150 when every block was built
    // out to eight of its nine cells; the blocks have gardens now and the city
    // is around 120. What has to hold is that this is checking a real city and
    // not an empty list.
    expect(city.length).toBeGreaterThan(100);

    for (const b of city) {
      const place = describePlace(b, b.cell);
      expect(place.title, `${b.kind} at ${b.cell.u},${b.cell.v}`).not.toBe("");
      expect(place.detail).not.toBe("");
    }
  });

  it("still answers an office with the office", () => {
    const office = city.find((b) => b.office === "charge.refund");
    expect(office).toBeDefined();

    const place = describePlace(office!, office!.cell);
    expect(place.office).toBe("charge.refund");
    expect(place.title).toBe("charge.refund");
    expect(place.detail).toBe("The Exchequer");
  });

  it("answers a house with the district it stands in", () => {
    const place = describePlace(building({ kind: "house", district: "records" }), { u: 4, v: 4 });

    expect(place.office).toBeNull();
    expect(place.district).toBe("records");
    expect(place.title).toBe("Records");
  });

  it("does not pretend a house is a capability", () => {
    // The one thing this must never do. An interface whose whole argument is
    // about stated authority matching actual authority cannot invent some to
    // fill a tooltip, and an operator told that a filler block is
    // `charge.refund` has been lied to in the place it matters most.
    const offices = new Set(OFFICES.map((entry) => entry.office));

    for (const b of city.filter((candidate) => candidate.kind !== "office")) {
      const place = describePlace(b, b.cell);
      expect(place.office).toBeNull();
      expect(offices.has(place.title), `${place.title} is an office name`).toBe(false);
    }
  });

  it("names the coastal works rather than calling them a district", () => {
    // They sit outside every plot and are the only structures that are purely
    // scenery, which the panel says in as many words.
    const place = describePlace(null, { u: 8, v: 30 });

    expect(place.title).toBe("Airfield");
    expect(place.detail).toContain("scenery");
  });

  it("answers open ground with where it is", () => {
    // A click that lands on a park used to clear the selection silently, which
    // reads as the map having lost interest.
    const inside = DISTRICT_PLOTS.find((p) => p.id === "exchequer")!;
    const place = describePlace(null, { u: inside.u0 + 1, v: inside.v0 + 1 });

    expect(place.district).toBe("exchequer");
    expect(place.title).toBe("The Exchequer");
  });

  it("does not claim a district for ground outside every one", () => {
    const place = describePlace(null, { u: 0, v: 0 });

    expect(place.district).toBeNull();
    expect(place.title).toBe("Outskirts");
  });
});

describe("the districts explain themselves", () => {
  it("has a note for every district the city draws", () => {
    // The districts are the metaphor and nothing on screen had ever explained
    // them, which is the other half of why the map was hard to read. A plot
    // added without a note would put an empty panel in front of a newcomer.
    for (const plot of DISTRICT_PLOTS) {
      expect(DISTRICT_NOTES[plot.id], `${plot.id} has no note`).toBeTruthy();
    }
  });

  it("has no note for a district that does not exist", () => {
    const ids = new Set(DISTRICT_PLOTS.map((plot) => plot.id));
    for (const id of Object.keys(DISTRICT_NOTES)) {
      expect(ids.has(id), `${id} is described but not drawn`).toBe(true);
    }
  });

  it("titles a district by the name the map paints on it", () => {
    expect(districtTitle("post-house")).toBe("Post House");
    expect(districtTitle(null)).toBe("Outskirts");
  });
});

describe("the pointer reaches the whole city", () => {
  const app = readFileSync(fileURLToPath(new URL("./App.tsx", import.meta.url)), "utf8");
  const scene = readFileSync(
    fileURLToPath(new URL("./render/scene.ts", import.meta.url)),
    "utf8",
  );

  it("selects by cell, not by office name", () => {
    // The reason two hundred and thirty buildings could not be selected: the
    // selection was an office name, and they have none. A cell is the one
    // identity every building has.
    expect(scene).toMatch(/readonly selected\?: \{ readonly u: number; readonly v: number \} \| null;/);
  });

  it("outlines whatever is picked, not only offices", () => {
    // The outline used to be nested inside `if (building.office)`, so it could
    // not appear on the rest of the city however the state was keyed.
    const marker = scene.indexOf("if (building.office) {");
    const outline = scene.indexOf("if (picked) drawSelection");
    expect(marker).toBeGreaterThan(-1);
    expect(outline).toBeGreaterThan(-1);
    expect(scene.slice(marker, outline)).toContain("}");
  });

  it("puts the inspector where it can be seen", () => {
    // Measured rather than guessed, and then fixed: below the other panels the
    // inspector opened at y=739 in a scrolling column that ended at y=449 on a
    // 1400x900 screen. Clicking a building opened a panel three hundred pixels
    // past the bottom of the page, which is indistinguishable from clicking a
    // building and nothing happening -- and that is what the map appeared to
    // do. The whole feature was invisible on the one screen it exists for.
    const stack = app.slice(app.indexOf('className="hud__scan-stack"'));
    const inspector = stack.indexOf("<BuildingInspector");
    const scan = stack.indexOf("<DistrictScan");

    expect(inspector).toBeGreaterThan(-1);
    expect(scan).toBeGreaterThan(-1);
    expect(inspector, "the inspector must be the first panel in the stack").toBeLessThan(scan);
  });

  it("hands the hover a place rather than an office", () => {
    expect(app).toContain("{ place: describePlace(building, cell), x: e.clientX, y: e.clientY }");
  });
});
