/**
 * The city's colours.
 *
 * Three shades per material, because an isometric solid shows exactly three
 * faces: the top catches the light, the screen-left wall is in half shadow, and
 * the screen-right wall is darkest. Picking those three by hand rather than by
 * multiplying one hue keeps the palette deliberate -- a face that is merely
 * "the same colour at 80% brightness" reads as washed out rather than shaded.
 *
 * Light comes from the upper left and never moves.
 */

export interface Material {
  readonly top: string;
  readonly left: string;
  readonly right: string;
  readonly edge: string;
}

export const GROUND: Record<string, Material> = {
  // Three greens close enough to read as one lawn, far enough apart to have
  // texture. A single flat green is the clearest sign a map was generated.
  grass: { top: "#63ad52", left: "#579b48", right: "#4c8b3f", edge: "#3a6b30" },
  sand: { top: "#ddc99a", left: "#c9b485", right: "#b3a074", edge: "#8f8059" },
  // Water comes in two depths and three shades each, and the three are much
  // closer together than a material's usual top/left/right. Those exist to
  // shade the faces of a solid; these are all the *top* of a flat tile, picked
  // per cell so a plane of identical diamonds gets edges. Spread them as far as
  // the greens and the sea reads as choppy static.
  water: { top: "#3f7fbd", left: "#3b7ab6", right: "#3775af", edge: "#22496f" },
  waterShallow: { top: "#59a2d4", left: "#549cce", right: "#4f96c8", edge: "#3c7fae" },
  road: { top: "#9298a1", left: "#82878f", right: "#71767d", edge: "#565b61" },
  pavement: { top: "#b6bcc4", left: "#a3a9b0", right: "#91969d", edge: "#70757b" },
  fogged: { top: "#39434f", left: "#323b46", right: "#2b333c", edge: "#232a32" },
  fogGrass: { top: "#3f4a45", left: "#39423e", right: "#333b38", edge: "#28302c" },
} as const;

/** Materials for the plain city blocks that fill a district. */
export interface BuildingStyleSet {
  readonly body: Material;
  readonly roof: Material;
  readonly glass: string;
  readonly glassDark: string;
}

/**
 * The everyday building. Pale concrete with a slate roof and blue glass, which
 * is what gives the reference its cool, uniform skyline -- variety comes from
 * height and rooftop clutter, not from painting every tower a new colour.
 */
export const CONCRETE: BuildingStyleSet = {
  body: { top: "#e6eaef", left: "#cfd6de", right: "#b6bec8", edge: "#5f6873" },
  roof: { top: "#3f6ea8", left: "#35608f", right: "#2c5178", edge: "#24405f" },
  glass: "#9fc6e8",
  glassDark: "#7d9dbb",
};

/** A low house, for the outskirts. */
export const HOUSE: BuildingStyleSet = {
  body: { top: "#eef1f4", left: "#dbe0e6", right: "#c5ccd4", edge: "#666f79" },
  roof: { top: "#4a76ad", left: "#3f6694", right: "#35577c", edge: "#2a4664" },
  glass: "#a9cde9",
  glassDark: "#86a6c2",
};

/** Anything fogged out: still a building, just not one you can reach. */
export const FOGGED: BuildingStyleSet = {
  body: { top: "#4a545f", left: "#414a54", right: "#39414a", edge: "#272e35" },
  roof: { top: "#3b4550", left: "#343d47", right: "#2d353d", edge: "#222930" },
  glass: "#4e5964",
  glassDark: "#454f59",
};

/**
 * The building the operator has clicked.
 *
 * An outline alone was not enough to find. It is one and a half pixels of gold
 * traced around a roof, on a skyline of two hundred and forty roofs, and at the
 * zoom the city opens at a whole building is about six pixels across -- so the
 * mark meant to answer "which one did I just pick" was smaller than the thing
 * it was marking. The body carries the answer now and the outline sharpens it.
 *
 * Warm, and deliberately the only warm building in a cool city: the palette is
 * concrete and slate everywhere else, so a single amber block is found by
 * glance rather than by search. It is the accent already used for authority
 * elsewhere in the HUD, which keeps one colour meaning one thing.
 */
export const SELECTED: BuildingStyleSet = {
  body: { top: "#f7d99a", left: "#e2bd76", right: "#c8a25c", edge: "#6d5324" },
  roof: { top: "#f0a830", left: "#d18f24", right: "#af761b", edge: "#7a5211" },
  glass: "#fff0cf",
  glassDark: "#d9b478",
};

/**
 * The building under the pointer.
 *
 * Lighter than the selection and cooler, because hover is a question and
 * selection is an answer. Two identical highlights would leave the operator
 * unable to tell what they had committed to from what they were merely near.
 */
export const HOVERED: BuildingStyleSet = {
  body: { top: "#fdf2dc", left: "#ecdcbe", right: "#d4c3a4", edge: "#6b6350" },
  roof: { top: "#6f93bd", left: "#5f80a6", right: "#4f6c8c", edge: "#3a5069" },
  glass: "#dcecfb",
  glassDark: "#adc3d8",
};

/**
 * District landmarks. Each is a distinct hue so six of them are told apart at a
 * glance and on video, which is the whole reason for having six districts
 * rather than two hundred buildings.
 */
export const LANDMARKS: Record<string, BuildingStyleSet> = {
  records: {
    body: { top: "#e8dcc0", left: "#d4c6a6", right: "#bcae8e", edge: "#6f6650" },
    roof: { top: "#8d6f4a", left: "#7a5f3f", right: "#674f34", edge: "#4a3826" },
    glass: "#f2e2b8",
    glassDark: "#b8a887",
  },
  exchequer: {
    body: { top: "#f0e3a8", left: "#dcce93", right: "#c3b67e", edge: "#756c45" },
    roof: { top: "#c9a227", left: "#ae8b20", right: "#93751a", edge: "#6b5513" },
    glass: "#fff3c4",
    glassDark: "#c9bb8a",
  },
  "post-house": {
    body: { top: "#e8c4b4", left: "#d3ad9d", right: "#bb9787", edge: "#6f5548" },
    roof: { top: "#b0503c", left: "#984433", right: "#7f382a", edge: "#5c281d" },
    glass: "#f6dccf",
    glassDark: "#bd9c8e",
  },
  yard: {
    body: { top: "#c3ccd6", left: "#adb6c0", right: "#98a0aa", edge: "#5b626a" },
    roof: { top: "#4d5966", left: "#424d58", right: "#38414a", edge: "#282f36" },
    glass: "#d6e2ee",
    glassDark: "#9aa6b2",
  },
  archive: {
    body: { top: "#d8cbe8", left: "#c2b4d3", right: "#aa9dba", edge: "#635a72" },
    roof: { top: "#6b57a0", left: "#5c4a8a", right: "#4d3d73", edge: "#382c55" },
    glass: "#e7ddf5",
    glassDark: "#a99cbd",
  },
  gate: {
    body: { top: "#dfd8cc", left: "#c9c2b6", right: "#b2aca1", edge: "#6a655d" },
    roof: { top: "#8a8073", left: "#776e62", right: "#645c52", edge: "#48423a" },
    glass: "#f0e9dd",
    glassDark: "#b5aea3",
  },
};

/** HUD chrome. One accent colour; a second turns an instrument into a toy. */
export const UI = {
  sky: "#22597f",
  panel: "#0e1622",
  panelEdge: "#1d2a3d",
  ink: "#c8d4e3",
  inkDim: "#6f8199",
  accent: "#f0a830",
  danger: "#e05a4a",
  good: "#4fbf7a",
  wall: "#ffc247",
  mast: "#3a424c",
  outline: "rgba(12, 18, 26, 0.8)",
  roadMarking: "rgba(236, 240, 245, 0.55)",
  shadow: "rgba(0, 0, 0, 0.22)",
  treeShadow: "rgba(0, 0, 0, 0.18)",
  treeTrunk: "#5a4230",
  treeShade: "#2f6b34",
  treeLight: "#3f8a41",
  treeFogShade: "#394640",
  treeFogLight: "#46534c",
  lamp: "#39424d",
  lampLight: "#f0d890",
  fountainStone: "#d8dee4",
  fountainShade: "#aeb8c2",
  fountainWater: "#72c7e8",
  fountainFogStone: "#4b555f",
  fountainFogWater: "#34434b",
  fountainFogShade: "#67717a",
  fountainFogJet: "#65747c",
  vehicleShadow: "rgba(0, 0, 0, 0.24)",
  vehicleWheel: "#222a31",
  vehicleFogBody: "#59636d",
  vehicleGlass: "#c8e5f4",
  vehicleFogGlass: "#414b55",
  vehicleFogLight: "#77818a",
  vehicleHeadlight: "#fff1a6",
  civicDomeFogBase: "#4b555f",
  civicDomeBase: "#eee9d9",
  civicDomeFog: "#59636c",
  civicDome: "#fffaf0",
  civicDomeFogMast: "#68727b",
  civicDomeMast: "#d7caa8",
} as const;

export const TRAFFIC_COLOURS = {
  red: "#d8584d", amber: "#f1b33b", blue: "#377fc1", ivory: "#efe9dc",
  green: "#5ba36b", pale: "#eee8da", brick: "#cf5f50", gold: "#e4aa38",
  sky: "#5f91c8", leaf: "#72a76a", cream: "#f0e8d8",
} as const;

/** Original shared palette for the airport, harbour, vessels, and wayfinding. */
export const COAST = {
  shadow: "rgba(0, 0, 0, 0.25)", runway: "#202a31", runwayMark: "#e7e5d8",
  hangarWall: "#68889b", hangarRoof: "#d7e5e7", hangarRoofAirport: "#bce8eb",
  hangarDoor: "#27465b", safety: "#f0a830", tower: "#778b95",
  towerCab: "#173247", towerGlass: "#9fd7e6", towerTrim: "#e8e0c9",
  plane: "#f2eee2", planeStripe: "#c94f46", billboardPost: "#493925",
  billboardFace: "#09151f", billboardText: "#a9bbca", pier: "#303b40",
  bollard: "#d39b43", containers: ["#c65d3d", "#d9a735", "#3e7894", "#648258"] as const,
  containerEdge: "rgba(8, 18, 25, 0.55)", crane: "#e0a33c",
  lighthouse: "#efe8d5", lighthouseStripe: "#c75045", lighthouseRoof: "#223745",
  lighthouseLamp: "#ffe58c", lighthouseBeam: "#fff3a8", wake: "rgba(220, 246, 255, 0.55)",
  shipWake: "rgba(224, 246, 255, 0.32)", boatHull: "#3a2a22", sail: "#f6f0df",
  cargoHull: "#172632", navyHull: "#28343b", cargoCab: "#dbe2df", navyCab: "#718087",
  cargoContainers: ["#bf5b3d", "#d5a13b", "#3f7890", "#6d8356"] as const,
  navyDeck: "#18262f", navyMark: "#d8b454", wave: "rgba(205, 237, 250, 0.24)",
} as const;

export const AGENT = {
  body: "#f7f0e2",
  bodyShade: "#d3c9b6",
  mark: "#1b2530",
  team: "#93cef5",
  teamShade: "#6ca6cd",
} as const;

export function landmarkStyle(district: string): BuildingStyleSet {
  return LANDMARKS[district] ?? LANDMARKS.records!;
}
