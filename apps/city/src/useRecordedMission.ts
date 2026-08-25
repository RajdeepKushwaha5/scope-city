import { useCallback, useEffect, useRef, useState } from "react";
import type { CityFeedEvent } from "@scope-city/mission";
import { cityViewFrom, type CityView } from "./city-view.js";
import { initialLiveCityState, reduceLiveCity, type LiveCityState } from "./live-state.js";
import { playRecording, type RecordedMission, type ReplayHandle } from "./replay/recorded.js";

/**
 * Watching a mission that already happened, with no server involved.
 *
 * This is what makes judge mode possible. The recording is a static file, the
 * reducer is the one the live stream uses, and nothing here needs a TrueForge
 * instance, a model key, or a network -- so a public URL with no sign-in shows
 * a real run rather than a description of one.
 */
export function useRecordedMission(): {
  readonly state: LiveCityState;
  /** The same mapping the live stream renders through, so the two cannot drift. */
  readonly view: CityView;
  readonly playing: boolean;
  readonly record: RecordedMission | null;
  readonly error: string | null;
  play: (url: string) => Promise<void>;
  stop: () => void;
} {
  const [state, setState] = useState<LiveCityState>(initialLiveCityState);
  const [playing, setPlaying] = useState(false);
  const [record, setRecord] = useState<RecordedMission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<ReplayHandle | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
  }, []);

  // A replay left running after unmount dispatches into a dead tree.
  useEffect(() => () => handleRef.current?.stop(), []);

  const play = useCallback(
    async (url: string) => {
      stop();
      setError(null);
      setState(initialLiveCityState);

      let loaded: RecordedMission;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        loaded = (await response.json()) as RecordedMission;
      } catch (cause) {
        setError(
          `Could not load the recording: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return;
      }

      if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
        setError("That recording has no events in it.");
        return;
      }

      setRecord(loaded);
      setPlaying(true);
      handleRef.current = playRecording(
        loaded,
        (event: CityFeedEvent) => setState((current) => reduceLiveCity(current, event)),
        () => setPlaying(false),
      );
    },
    [stop],
  );

  const view = cityViewFrom({
    state,
    // A recording carries its scope in the file, but the reducer never sees a
    // scope event, so the limits are not drawn from one. The job line comes
    // from the recording itself.
    scope: null,
    expiresIn: null,
    idleJob: record?.job ?? "No mission",
  });

  return { state, view, playing, record, error, play, stop };
}
