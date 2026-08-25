import type { CityFeedEvent } from "@scope-city/mission";

/**
 * Replaying a mission that actually happened.
 *
 * Judge mode has to work with no backend: a public URL, no sign-in, nothing to
 * install. The obvious way to do that is to script a demo, and the obvious
 * problem with a scripted demo is that it proves nothing -- a city refusing a
 * call is exactly as convincing as the author chose to make it.
 *
 * A recorded mission is the honest version. The file is what the control plane
 * produced during a real run against a real TrueForge session: the same
 * derivation, the same Yard report, the same refusals, the same gates. It is
 * hash-chained, so a sceptical reader can check the events were not rearranged
 * afterwards, and it carries the granted scope, so they can see what authority
 * those events were taken under.
 *
 * Replay drives the same reducer the live stream drives. There is no second
 * code path that could flatter the first.
 */

export interface RecordedEntry {
  readonly sequence: number;
  readonly at: number;
  readonly event: CityFeedEvent;
  readonly hash: string;
}

export interface RecordedMission {
  readonly missionId: string;
  readonly scopeId: string;
  readonly job: string;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly entries: readonly RecordedEntry[];
  readonly head: string;
  readonly algorithm: string;
  readonly lossy: boolean;
}

/**
 * Real elapsed time between two entries, compressed for watching.
 *
 * A faithful replay would spend most of its runtime on model latency, which is
 * the least interesting thing in the file. Pauses are scaled down and clamped
 * so the *shape* of the mission survives -- a gate still visibly waits, calls
 * still land in sequence -- without a viewer watching an idle city for the
 * eleven seconds a turn happened to take.
 */
export function replayDelay(previousAt: number, at: number): number {
  const elapsed = Math.max(0, at - previousAt);
  return Math.min(1_200, Math.max(90, Math.round(elapsed / 6)));
}

export interface ReplayHandle {
  /** Stops the replay. Safe to call twice. */
  stop(): void;
}

/**
 * Plays a recorded mission into a callback, one event at a time.
 *
 * Returns a handle rather than a promise because the caller is a component that
 * can unmount mid-replay, and a replay that keeps dispatching into a dead tree
 * is a memory leak with a React warning attached.
 */
export function playRecording(
  record: RecordedMission,
  emit: (event: CityFeedEvent) => void,
  onDone?: () => void,
): ReplayHandle {
  let index = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const step = (): void => {
    if (stopped) return;

    const entry = record.entries[index];
    if (!entry) {
      onDone?.();
      return;
    }

    emit(entry.event);
    const previous = record.entries[index - 1];
    index += 1;

    const next = record.entries[index];
    if (!next) {
      onDone?.();
      return;
    }

    timer = setTimeout(step, replayDelay(previous?.at ?? entry.at, next.at));
  };

  // Deferred rather than called inline: the caller is mid-render when it starts
  // a replay, and dispatching the first event synchronously updates state
  // during render.
  timer = setTimeout(step, 0);

  return {
    stop() {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}
