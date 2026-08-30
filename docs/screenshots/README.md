# Screenshots

The README references these by filename. Drop the files in and they appear.

| File | What to capture |
|---|---|
| `city-wide.png` | The whole island, no panels open. The establishing shot. |
| `scope-granted.png` | The **City Limits** panel with a granted scope: the offices, the exact ids, the ceiling, the countdown. |
| `yard-adversary.png` | **The Yard** after the local adversary has run, showing the model name and the attacks it wrote with their verdicts. |
| `gate.png` | **The Gate** holding an irreversible call, with the exact charge and amount visible. |
| `refused.png` | A refusal at the city limits: the agent stopped at the line, with the reason in the log. |

## Capturing them

Run the city and take them at **1920x1080**, browser zoom 100%.

```powershell
$env:NODE_OPTIONS="--experimental-sqlite"
cd apps\demo; npx tsx watch src/live-server.ts   # wait for the control plane line
cd apps\city; npx vite                            # then open http://127.0.0.1:5180/
```

Two rules, so a screenshot never claims more than a run did:

- Capture from a real mission or the shipped replay. Never stage a panel that a
  run did not produce.
- No `.env`, no keys, no tokens, no personal information in frame.

## How the demo GIF was made

`docs/media/scope-city-demo.gif` is not a hand-held screen recording. It was
captured by driving the real application in a real browser, so it can be
remade whenever the interface changes.

- `playwright-core` launched the installed Chrome against
  `http://127.0.0.1:5180/` with `recordVideo`, drove the actual controls
  (dismiss the intro, type the order, Dispatch, Grant twice, wait), and wrote a
  1280x800 webm.
- `ffmpeg-static` cut the useful window, sped it up six times, and produced a
  palette-optimised GIF at 760px.

Neither package is a dependency of this repository. They were installed outside
it for the capture, so nothing here carries a browser driver it does not
otherwise need.

Only the speed was altered. The mission was real, the control plane was live,
and the console text in the frame is what the run produced.
