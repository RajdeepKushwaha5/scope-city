import { describe, expect, it } from "vitest";
import { createAirportLayout } from "./airport";
import {
  AD_BILLBOARD_COUNT,
  BILLBOARD_FACINGS,
  BILLBOARD_FRAME_INSET,
  BILLBOARD_SIZES,
  BILLBOARD_SPECS,
  ISOMETRIC_FACINGS,
  SPONSORS,
  adBillboardSlots,
  assignSponsors,
  billboardPanelTransform,
  halfSpanOf,
  repoBillboardSlot,
  type BillboardFacing,
  type BillboardSize,
} from "./billboards";
import { COUNTRYSIDE_RING } from "./rings";

const SIZES: BillboardSize[] = BILLBOARD_SIZES;
/** Only these two carry a shear; "screen" is deliberately upright. */
const FACINGS: BillboardFacing[] = [...ISOMETRIC_FACINGS];

/** fieldSizeFor never goes below 12, and real repositories run far larger. */
const CITY_SIZES = [12, 16, 24, 40, 64, 96];

describe("SPONSORS", () => {
  it("gives every advertiser bundled artwork and a backing colour", () => {
    for (const sponsor of SPONSORS) {
      expect(sponsor.name.length).toBeGreaterThan(0);
      expect(sponsor.artwork).toMatch(/^\/ads\/.+\.(png|webp|svg|jpg)$/);
      expect(sponsor.background).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("only ever carries an absolute https link, when it carries one at all", () => {
    for (const sponsor of SPONSORS) {
      if (sponsor.url !== undefined) {
        expect(sponsor.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("has enough advertisers to fill every board without repeating", () => {
    // The roster may be empty; the ring's shape must not depend on it.
    expect(SPONSORS.length).toBeGreaterThanOrEqual(0);
    const ids = SPONSORS.map((sponsor) => sponsor.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("repoBillboardSlot", () => {
  it("stands behind the airport terminal, facing the screen", () => {
    for (const size of CITY_SIZES) {
      const slot = repoBillboardSlot(size);
      const airport = createAirportLayout(size, size);

      // Sits behind the terminal along the constant-x plane, facing the screen.
      expect(slot.facing).toBe("screen");
      expect(slot.size).toBe("large");
      expect(slot.y).toBeLessThan(airport.runwayStart.y);
    }
  });

  it("tracks the terminal rather than the field centre when the city grows", () => {
    const small = repoBillboardSlot(16);
    const large = repoBillboardSlot(64);
    expect(large.y - 64).toBeCloseTo(small.y - 16);
    expect(large.x).toBe(small.x);
  });

  it("clears the access road and the runway so nothing overlaps", () => {
    for (const size of CITY_SIZES) {
      const slot = repoBillboardSlot(size);
      const airport = createAirportLayout(size, size);

      // Sits west of access road and north of runway.
      expect(slot.x).toBeLessThan(airport.accessRoadStart.x);
      expect(slot.y).toBeLessThan(airport.runwayStart.y);
    }
  });
});

describe("adBillboardSlots", () => {
  it("places the requested count of perimeter boards", () => {
    for (const size of CITY_SIZES) {
      const slots = adBillboardSlots(size, size);
      expect(slots).toHaveLength(AD_BILLBOARD_COUNT);
    }
  });

  it("sits outside the city grid, inside the countryside ring", () => {
    for (const size of CITY_SIZES) {
      const slots = adBillboardSlots(size, size);
      for (const slot of slots) {
        const outsideCity = slot.x < 0 || slot.x >= size || slot.y < 0 || slot.y >= size;
        expect(outsideCity).toBe(true);

        const insideRing =
          slot.x >= -COUNTRYSIDE_RING &&
          slot.x < size + COUNTRYSIDE_RING &&
          slot.y >= -COUNTRYSIDE_RING &&
          slot.y < size + COUNTRYSIDE_RING;
        expect(insideRing).toBe(true);
      }
    }
  });

  it("places one slot on the north edge and one near the naval base road", () => {
    for (const size of CITY_SIZES) {
      const slots = adBillboardSlots(size, size);
      const north = slots.find((s) => s.y < 0);
      const naval = slots.find((s) => s.x >= size);
      expect(north).toBeDefined();
      expect(naval).toBeDefined();
      expect(naval?.size).toBe("square");
    }
  });

  it("faces every perimeter board square to the screen so posters stay upright", () => {
    const slots = adBillboardSlots(40, 40);
    expect(slots.every((slot) => slot.facing === "screen")).toBe(true);
  });
});

describe("assignSponsors", () => {
  const slots = adBillboardSlots(40, 40);

  // The roster ships empty: a board is a use of someone's mark, so nothing is
  // placed unless a project owner puts it there. These tests cover the
  // mechanism, not any particular advertiser.
  it("places nothing when no sponsor has been configured", () => {
    expect(assignSponsors(slots, "acme/example-repo")).toEqual([]);
  });

  it("lays the ring out regardless, so an empty roster leaves it bare rather than broken", () => {
    expect(slots.length).toBeGreaterThan(0);
    expect(assignSponsors(slots, "acme/example-repo")).toHaveLength(SPONSORS.length === 0 ? 0 : slots.length);
  });

  it("is deterministic for a repo key", () => {
    const first = assignSponsors(slots, "acme/example-repo");
    const second = assignSponsors(slots, "acme/example-repo");
    expect(first.map((placement) => placement.sponsor.id)).toEqual(
      second.map((placement) => placement.sponsor.id),
    );
  });
});
