# Attribution

## Fonts

Loaded from Google Fonts, licensed under the SIL Open Font License 1.1.

- **Silkscreen** — Jason Kottke
- **VT323** — Peter Hunt

## Artwork

There are no third-party image assets in this repository. Every sprite, tile,
and building in the city is drawn procedurally at runtime from the primitives in
`apps/city/src/render` — the palette derives three shades per material from a
single fixed light direction, and shapes are baked to an offscreen canvas per
variant and blitted.

Any third-party art added later must be listed here with its licence before it
is merged.

## Dependencies

Third-party runtime and build dependencies are declared in the workspace
`package.json` files and pinned in `pnpm-lock.yaml`, each under its own licence.
Notable ones: [TrueForge](https://github.com/truefoundry/trueforge) (the agent
harness this is built on), the Model Context Protocol TypeScript SDK, React, and
Vite.

## Development

Built with the assistance of AI coding tools, as permitted and required to be
disclosed by the hackathon rules.
