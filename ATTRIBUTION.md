# Attribution

Everything the project ships, and where it came from.

## Fonts

Loaded from Google Fonts, licensed under the SIL Open Font License 1.1.

- **Silkscreen** by Jason Kottke
- **VT323** by Peter Hunt

## Artwork

The city is drawn procedurally at runtime from the primitives in
`apps/city/src/render`. The palette derives three shades per material from one
fixed light direction, and shapes are baked to an offscreen canvas per variant
and blitted. Every sprite, tile and building on the map is generated this way.
None of it is a third-party asset.

The favicon (`apps/city/public/favicon.svg`) is hand-written SVG. The interface
sounds are synthesised in the browser with the Web Audio API
(`apps/city/src/hud/sound-engine.ts`). There are no audio files.

### Where the look came from

The idea of drawing an agent's world as an isometric city, with connected
systems as districts and tools as buildings, is not original to this project. It
was inspired by **Claude City**, and the resemblance is deliberate.

What is original is the implementation. Every renderer, layout rule and shape in
`apps/city/src/render` was written for this repository, and the thing being
visualised is different: Claude City draws a codebase, and Scope City draws an
authority boundary. Districts here are connected systems, buildings are MCP
tools, and the city limits are a granted scope.

This is stated plainly because it should not be discovered. An earlier draft of
this file and of the README described the city as "clean-room", which is not the
right word when the reference project was open on the same machine. The word has
been removed.

### Raster images

**There are none.** Every pixel on screen is generated at runtime from code.

There were three, briefly, and the way they left is worth writing down.

`apps/city/public/crew` held `effort-low.png`, `effort-medium.png` and
`effort-high.png`: crew portraits in the dispatch dialog, added on 2026-08-26.
This file carried a note saying their provenance had to be confirmed before
release, because nothing in the repository could establish where they came from,
and an attribution file is the wrong place to guess.

Confirmed on 2026-08-30, and the answer was that they were not ours. They are
byte-identical copies of Claude City's crew artwork. SHA-256 matches against its
`sonnet-low/medium/high.png`, renamed to fit this dialog. No licence was
established for them and none was sought.

They are deleted. The dialog now draws an `EffortGauge` in `CrewModal.tsx`:
three bars, filling left to right. That is more consistent with the rest of the
project than the portraits were, because the map has always been generated
rather than drawn by hand, and it says something the portraits did not, which is
that the setting is about how much the model thinks.

Two things this does not claim. The files remain in the git history of the
commits that added and removed them, and removing them from the working tree is
not the same as removing them from the repository's past. And the note that
flagged this was written by the same process that shipped the files, so it
caught the problem late rather than preventing it.

Any third-party art added later must be listed here with its licence **before**
it is merged. The rule existed already. This is what it looks like when it is
applied after the fact instead.

## Demo data

No real customer data appears anywhere in this repository.

- The support tickets, order numbers and customer names in `mcp/src/systems/`
  are invented for the demo. The poisoned ticket was written to carry a prompt
  injection on purpose.
- Payments run against **Stripe test mode**. The charge ids in the shipped
  recording are test-mode ids and no real money moved.
- Mail is delivered to **Mailpit**, a local SMTP server that catches messages
  instead of sending them. `customer@example.test` is a reserved example domain.
- The shipped recording, `apps/city/public/replays/refund-184.json`, is a real
  session against those test systems.

## Dependencies

Third-party runtime and build dependencies are declared in the workspace
`package.json` files and pinned in `pnpm-lock.yaml`, each under its own licence.

The notable ones:

- [TrueForge](https://github.com/truefoundry/trueforge), TrueFoundry's
  open-source agent harness, which runs the agent, its subagents, the sandbox
  and the approval gate.
- The [Model Context Protocol](https://modelcontextprotocol.io) TypeScript SDK,
  used on both sides: Scope City is an MCP server to TrueForge, and an MCP
  client to servers it did not write.
- `@modelcontextprotocol/server-github`, pinned to `2025.4.8`, which the Forge
  district runs as a subprocess. It is the archived reference implementation;
  the reasons for pinning rather than migrating are in issue #105.
- React, Vite, TypeScript, Vitest.

## Development

Built during the hackathon week with AI coding assistants, principally
**Claude Code**, used throughout and disclosed here as the rules require.

The architecture, the security model, and the decisions about what to claim and
what to leave out are the author's. The reasoning behind the load-bearing ones
is written into the code as comments rather than left implicit, so a reader can
check the thinking rather than take it on trust.
