# Attribution

## Fonts

Loaded from Google Fonts, licensed under the SIL Open Font License 1.1.

- **Silkscreen** — Jason Kottke
- **VT323** — Peter Hunt

## Artwork

The city itself is drawn procedurally at runtime from the primitives in
`apps/city/src/render` — the palette derives three shades per material from a
single fixed light direction, and shapes are baked to an offscreen canvas per
variant and blitted. Every sprite, tile and building on the map is generated
this way, and none of it is a third-party asset.

### Raster images

**There are none.** Every pixel on screen is generated at runtime from code.

There were three, briefly, and the way they left is worth writing down.

`apps/city/public/crew` held `effort-low.png`, `effort-medium.png` and
`effort-high.png`: crew portraits in the dispatch dialog, added on 2026-08-26.
This file carried a note saying their provenance had to be confirmed before
release, because nothing in the repository could establish where they came from
and an attribution file is the wrong place to guess.

Confirmed on 2026-08-30, and the answer was that they were not ours. They are
byte-identical copies of another project's artwork -- SHA-256 matches against
`sonnet-low/medium/high.png` from a reference project on the same machine --
renamed to fit this dialog. No licence was established for them and none was
sought.

They are deleted. The dialog now draws an `EffortGauge`: three bars, filling
left to right, in `CrewModal.tsx`. That is more consistent with the rest of the
project than the portraits were -- the map has always been generated rather than
drawn by hand -- and it says something the portraits did not, which is that the
setting is about how much the model thinks.

Two things this does not claim. The files remain in the git history of the
commits that added and removed them; removing them from the working tree is not
the same as removing them from the repository's past. And the note that flagged
this was written by the same process that shipped the files, so it caught the
problem late rather than preventing it.

Any third-party art added later must be listed here with its licence **before**
it is merged. The rule existed already; this is what it looks like when it is
applied after the fact instead.

## Dependencies

Third-party runtime and build dependencies are declared in the workspace
`package.json` files and pinned in `pnpm-lock.yaml`, each under its own licence.
Notable ones: [TrueForge](https://github.com/truefoundry/trueforge) (the agent
harness this is built on), the Model Context Protocol TypeScript SDK, React, and
Vite.

## Development

Built with the assistance of AI coding tools, as permitted and required to be
disclosed by the hackathon rules.
