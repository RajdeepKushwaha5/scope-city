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
  water: { top: "#3f7fbd", left: "#356ba2", right: "#2c5a89", edge: "#22496f" },
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
  lamp: "#39424d",
  lampLight: "#f0d890",
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
