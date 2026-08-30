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
