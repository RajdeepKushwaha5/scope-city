import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FACILITIES,
  ROAD_EVERY,
  apronEdges,
  facilityAt,
  isApron,
  isFacilityCell,
  layOutCity,
  tileKindAt,
  treeCells,
} from "./world.js";
import { OFFICES } from "../useMission.js";
import { SIGN_MAX } from "./shapes.js";
import { facilityProps } from "./scene.js";

/**
 * Hardstanding.
 *
 * The three coastal facilities were built on lawn and pavement, which is what
 * made them read as models placed on the map rather than as places -- nothing
 * about a hangar says "airfield" if the grass runs up to its doors.
 */

describe("what counts as apron", () => {
  it("covers the ground inside a facility", () => {
    // Not `u0 + 1, v0 + 1`: the yard is crossed by streets, and that corner
    // happens to be one of them. Picked from the tile kind rather than from
    // arithmetic on the corner.
    expect(tileKindAt(35, 22)).toBe("pavement");
    expect(isApron(35, 22)).toBe(true);
  });

  it("reaches the water's edge", () => {
    // Sand counts inside a facility. A quay is paved to the water -- that is
    // what makes it a quay rather than a beach with bollards on it -- and the
    // naval yard reaches the shore, so leaving the last row as sand left the
    // berth standing on a beach with a warship alongside.
    expect(tileKindAt(39, 20)).toBe("sand");
    expect(isApron(39, 20)).toBe(true);
  });

  it("leaves the streets alone", () => {
    // A service road along the back of the yard is a real thing, the traffic
    // already drives it, and paving it over would put cars on the apron with no
    // lane to be in.
    for (let u = FACILITIES.naval.u0; u <= FACILITIES.naval.u1; u += 1) {
      for (let v = FACILITIES.naval.v0; v <= FACILITIES.naval.v1; v += 1) {
        if (tileKindAt(u, v) === "road") expect(isApron(u, v), `${u},${v}`).toBe(false);
      }
    }
  });

  it("stops at the fence", () => {
    const yard = FACILITIES.naval;
    expect(isApron(yard.u0 - 1, yard.v0 + 1)).toBe(false);
    expect(isApron(yard.u0 + 1, yard.v0 - 1)).toBe(false);
  });

  it("is never water", () => {
    for (let u = -2; u <= 44; u += 1) {
      for (let v = -2; v <= 38; v += 1) {
        if (isApron(u, v)) expect(tileKindAt(u, v), `${u},${v}`).not.toBe("water");
      }
    }
  });
});

describe("the painted edge", () => {
  it("marks only the faces that front onto the outside", () => {
    // The first version inset a whole diamond inside every edge tile, and a run
    // of those is not a boundary -- it is a chain of yellow lozenges. One face
    // per tile means consecutive tiles join into a continuous line.
    const yard = FACILITIES.naval;
    expect(apronEdges(yard.u0, yard.v0 + 2)).toEqual(["-u"]);
    expect(apronEdges(yard.u0, yard.v0)).toEqual(["-u", "-v"]);
  });

  it("says nothing about the middle", () => {
    expect(apronEdges(FACILITIES.naval.u0 + 1, FACILITIES.naval.v0 + 1)).toEqual([]);
  });

  it("says nothing about ground that is not apron", () => {
    // Asked of every tile, so it has to answer for the ones it does not own.
    expect(apronEdges(20, 17)).toEqual([]);
    expect(apronEdges(-5, -5)).toEqual([]);
  });
});

describe("the facility rectangles", () => {
  it("name the cell they contain", () => {
    expect(facilityAt(FACILITIES.airport.u0, FACILITIES.airport.v0)).toBe("airport");
    expect(facilityAt(FACILITIES.port.u1, FACILITIES.port.v1)).toBe("port");
    expect(facilityAt(20, 17)).toBeNull();
  });

  it("agree with the predicate the layout uses", () => {
    // `isFacilityCell` is what keeps buildings and trees off these rectangles.
    // It is derived from the same table now, and this is the assertion that
    // stops the two drifting apart and putting a tower on the runway.
    for (const box of Object.values(FACILITIES)) {
      for (let u = box.u0; u <= box.u1; u += 1) {
        for (let v = box.v0; v <= box.v1; v += 1) {
          expect(isFacilityCell(u, v), `${u},${v}`).toBe(true);
        }
      }
    }
  });

  it("still keep the city off them", () => {
    const city = layOutCity(OFFICES);
    expect(city.some((b) => isFacilityCell(b.cell.u, b.cell.v))).toBe(false);
    expect(treeCells(city).some((c) => isFacilityCell(c.u, c.v))).toBe(false);
  });
});

describe("the naval yard", () => {
  const scene = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");
  /*
   * The yard has no function of its own any more.
   *
   * These used to slice `navalYardItems` out of the source. That function is
   * gone: its props are entries in `facilityProps` like every other facility's,
   * because keeping them separate is what let the placement checks quietly stop
   * covering them.
   *
   * What is left to check in the source is the fence, which is the one part
   * that is geometry rather than a coordinate.
   */
  const naval = () => facilityProps(0).filter((prop) => prop.facility === "naval");

  it("is actually put on the screen", () => {
    // `facilityItems` maps the whole table, so nothing can be in it and not
    // drawn -- which is the property the old slice was trying to establish.
    expect(scene).toContain("facilityProps(time).map((prop)");
    expect(naval().length).toBeGreaterThan(0);
  });

  it("dims with the ground it stands on", () => {
    expect(scene).toContain("ctx.globalAlpha = 0.4");
    expect(scene).toContain("isInScope({ u: prop.u, v: prop.v }, state.granted)");
  });

  it("leaves a gate where the road meets it", () => {
    // A base is a fence with a way through. Fencing the road as well would make
    // it a box, with traffic driving through the wire.
    const fenced = new Set(
      [...scene.matchAll(/at\("naval", ([\w.]+), ([\w.]+), 1, \(ctx\) => drawFence/g)].map(
        (m) => `${m[1]}:${m[2]}`,
      ),
    );
    expect(fenced.size, "two fence runs").toBe(2);
    expect(scene).toContain("% ROAD_EVERY === 0) continue");
  });

  it("is a place rather than a berth", () => {
    // It was a line of piers and a warship. Everything that says "shore
    // establishment" was missing, so the most distinctive corner of the island
    // read as a grey rectangle with a boat parked at it.
    const yardSource = scene.slice(
      scene.indexOf("--- the naval yard"),
      scene.indexOf("return props;"),
    );
    for (const prop of ["drawFence", "drawFuelTank", "drawFloodlight", "drawFlag", "drawQuayHut", "drawRadar"]) {
      expect(yardSource, `the yard has no ${prop}`).toContain(prop);
    }
  });

  it("fences the land and not the water", () => {
    // Fencing the quay would wall the ship off from its own jetty.
    const fenceRuns = [...scene.matchAll(/drawFence\(ctx, ([\w.]+), ([\w.]+), "([-+][uv])"/g)];
    expect(fenceRuns.length).toBe(2);
    for (const run of fenceRuns) {
      expect(run[1] === "yard.u0" || run[2] === "yard.v0", "a fence on the seaward side").toBe(true);
      // And on the outward face of that cell. The panels were drawn
      // symmetrically about the tile centre, which put the whole perimeter half
      // a tile inside the yard -- a strip of apron outside the wire, and the
      // fence cutting through the cells it was meant to enclose.
      expect(run[3], "a fence facing into the yard").toMatch(/^-[uv]$/);
    }
  });

  it("puts every prop on its own apron", () => {
    // Over the table, not over a regex against the source.
    //
    // The first version of this matched direct calls with integer coordinates,
    // which quietly excluded every prop generated in a loop -- the runway
    // segments, the container stacks, and the bollards along both quays. Moving
    // any of those into the water would have left it green. It also accepted
    // any facility rather than the intended one, so a terminal placed on the
    // port's apron passed as happily as one on the airfield's.
    const props = facilityProps(0);
    expect(props.length).toBeGreaterThanOrEqual(30);

    for (const prop of props) {
      const box = FACILITIES[prop.facility];
      const owner = facilityAt(Math.floor(prop.u), Math.floor(prop.v));

      if (owner !== null) {
        // Inside a facility, it must be inside its own. A terminal on the
        // port's apron passed the first version of this, which accepted any
        // non-null answer.
        expect(
          owner,
          `a ${prop.facility} prop at ${prop.u},${prop.v} is on the wrong facility`,
        ).toBe(prop.facility);
      } else {
        /*
         * Outside every facility, which only `water` and `over` may be -- and
         * then only just outside their own.
         *
         * The first version wrote `facilityAt(...) ?? prop.facility`, which
         * made the assertion tautological for exactly the props that are
         * allowed to sit off the apron: a ship moved to the far side of the
         * island would have passed. Being permitted to float is not permission
         * to float anywhere.
         */
        expect(
          prop.ground,
          `a ${prop.facility} prop at ${prop.u},${prop.v} is outside every facility`,
        ).not.toBe("apron");

        const away = Math.max(
          box.u0 - prop.u,
          prop.u - box.u1,
          box.v0 - prop.v,
          prop.v - box.v1,
          0,
        );
        expect(
          away,
          `a ${prop.facility} prop at ${prop.u},${prop.v} is ${away} cells from its facility`,
        ).toBeLessThanOrEqual(4);
      }

      if (prop.ground === "water") {
        /*
         * Afloat means on water, not merely off the apron.
         *
         * Declaring a prop `water` exempts it from the apron check, so the
         * declaration has to be checked or wrong metadata becomes a way out of
         * the test. Asserting only "not apron" is not enough: this island
         * carries two rows of sand past the quay, and a cargo ship moored at
         * v=33.2 is on the beach while satisfying every weaker form of this.
         * It did, and both earlier versions of this check passed it.
         */
        expect(
          tileKindAt(Math.round(prop.u), Math.round(prop.v)),
          `a ${prop.facility} prop at ${prop.u},${prop.v} is declared afloat and is aground`,
        ).toBe("water");
        continue;
      }

      if (prop.ground !== "apron") continue;
      expect(
        isApron(Math.floor(prop.u), Math.floor(prop.v)),
        `a ${prop.facility} prop at ${prop.u},${prop.v} is on a street or in the water`,
      ).toBe(true);
    }
  });

  it("covers the props the old check could not see", () => {
    // Named counts, so this test cannot pass by finding fewer things. The
    // runway is eleven segments, the port quay ten bollards and the naval quay
    // eight; none of them were in the regex.
    const props = facilityProps(0);
    const on = (facility: string) => props.filter((prop) => prop.facility === facility).length;

    // The runway is eleven segments, the port quay eight bollards once the two
    // street crossings are left open, and the naval quay six for the same
    // reason. None of them were in the regex.
    expect(on("airport")).toBeGreaterThanOrEqual(11 + 7);
    expect(on("port")).toBeGreaterThanOrEqual(8 + 6);
    // The naval yard's establishment lives in the same table now. It used to be
    // built separately in `navalYardItems`, so replacing the regex with the
    // table quietly dropped the quay hut, both fuel tanks, the radar, both
    // floodlights and both flags out of every placement check -- the fix for
    // one gap opening another.
    expect(on("naval")).toBeGreaterThanOrEqual(6 + 8);
  });

  it("says which of them are deliberately not on apron", () => {
    // The honest half. Ships float, the lighthouse stands on the point past the
    // quay, the aircraft sits between two runway cells, and the runway itself
    // is laid across the street grid because that is what a runway does. If
    // those had to be on apron the test would be wrong rather than the
    // placements -- so they are declared rather than skipped by a regex that
    // happened not to match them.
    const props = facilityProps(0);
    const afloat = props.filter((prop) => prop.ground === "water");
    const over = props.filter((prop) => prop.ground === "over");

    /*
     * By identity, not by count.
     *
     * A lower bound lets one of these be reclassified without failing, and
     * reclassifying is the whole risk: changing the aircraft from `over` to
     * `apron` satisfies the general apron check further up, so the exception
     * this test exists to record would disappear silently. I loosened these to
     * `>=` to stop them breaking when the list grew, which traded the property
     * for the convenience.
     *
     * Naming them keeps both: the list may grow, and nothing already declared
     * can quietly change what it is.
     */
    const where = (kind: string) =>
      props
        .filter((prop) => prop.ground === kind)
        .map((prop) => `${prop.facility} ${prop.u},${prop.v}`)
        .sort();

    expect(where("water"), "the ships and the jetty").toEqual([
      "naval 41.5,22",
      "port 30.5,35.4",
      "port 33,35",
    ]);

    // Eleven runway segments and the aircraft standing on them.
    expect(where("over")).toHaveLength(12);
    expect(where("over"), "the aircraft is on the runway, not on apron").toContain(
      "airport 8,29.5",
    );
    expect(
      props.filter((prop) => prop.ground === "apron").length,
      "most of a facility should be on its own hard standing",
    ).toBeGreaterThan(afloat.length + over.length);
  });

  it("keeps every nameplate short enough to read", () => {
    // The board is a fixed size and the type is not fitted to it. A name that
    // does not fit gets cut rather than shrunk, so the limit has to be checked
    // here instead of discovered on screen.
    //
    // Asserting the count first, because the regex can match nothing: a name
    // passed as a variable rather than a literal would empty the loop and let
    // an overlong one through while the test stayed green. A loop that runs
    // zero times is not a check.
    const scene_ = readFileSync(fileURLToPath(new URL("./scene.ts", import.meta.url)), "utf8");
    const signs = [...scene_.matchAll(/drawFacilitySign\(ctx, [\d.]+, [\d.]+, "([^"]+)"\)/g)];

    const calls = (scene_.match(/drawFacilitySign\(/g) ?? []).length;
    expect(signs.length, "a nameplate is named by something other than a literal").toBe(calls);
    expect(signs.length, "no nameplates found at all").toBeGreaterThanOrEqual(2);

    for (const sign of signs) {
      expect(sign[1]!.length, `${sign[1]} does not fit a nameplate`).toBeLessThanOrEqual(SIGN_MAX);
    }
  });
});
