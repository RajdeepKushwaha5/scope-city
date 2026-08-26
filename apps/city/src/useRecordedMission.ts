import { useCallback, useEffect, useRef, useState } from "react";
import type { CityFeedEvent } from "@scope-city/mission";
import { cityViewFrom, type CityView } from "./city-view.js";
import {
  initialLiveCityState,
  reduceLiveCity,
  scopeViewFromWire,
  type LiveCityState,
} from "./live-state.js";
import { playRecording, type RecordedMission, type ReplayHandle } from "./replay/recorded.js";
import { verifyRecording, type ReplayVerdict } from "./replay/verify.js";

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
  /** The chain verdict, computed before a single event was replayed. */
  readonly verdict: ReplayVerdict | null;
  readonly error: string | null;
  play: (url: string) => Promise<void>;
  stop: () => void;
} {
  const [state, setState] = useState<LiveCityState>(initialLiveCityState);
  const [playing, setPlaying] = useState(false);
  const [record, setRecord] = useState<RecordedMission | null>(null);
  const [verdict, setVerdict] = useState<ReplayVerdict | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handleRef = useRef<ReplayHandle | null>(null);
  const loadRef = useRef<symbol | null>(null);

  const stop = useCallback(() => {
    handleRef.current?.stop();
    handleRef.current = null;
    // Any fetch still in flight is abandoned along with the replay it was for.
    loadRef.current = null;
    setPlaying(false);
  }, []);

  // A replay left running after unmount dispatches into a dead tree.
  useEffect(() => () => handleRef.current?.stop(), []);

  const play = useCallback(
    async (url: string) => {
      stop();
      setError(null);
      setState(initialLiveCityState);

      // Guards against a second play() landing while the first is still
      // fetching. Without it the slower response wins whichever order the two
      // were started in, and the city plays a recording nobody asked for.
      const token = Symbol("replay");
      loadRef.current = token;

      let loaded: RecordedMission;
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        loaded = (await response.json()) as RecordedMission;
      } catch (cause) {
        if (loadRef.current !== token) return;
        setError(
          `Could not load the recording: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
        return;
      }

      if (loadRef.current !== token) return;

      if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
        setError("That recording has no events in it.");
        return;
      }

      // Verified before a single event is replayed.
      //
      // A recording is offered as evidence, and evidence nobody checks is
      // decoration. Replaying first and verifying later would put the altered
      // events on screen and correct them afterwards, which is the wrong order
      // for the one feature whose whole claim is that this happened.
      //
      // This also subsumes the lossy check: an incomplete history is refused
      // here rather than in a second place that could disagree with it.
      const checked = await verifyRecording(loaded);
      if (loadRef.current !== token) return;
      setVerdict(checked);

      if (!checked.ok) {
        setError(`That recording does not verify: ${checked.reason}.`);
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

  // The scope comes from the replayed events, not the file's header.
  //
  // It used to come from `record.scope`, which was right when the feed carried
  // no scope events and a replay would otherwise have drawn no city limits at
  // all. The feed carries them now, and reading the header instead showed the
  // *granted* scope from the first frame -- so judge mode displayed granted
  // offices before `scope.granted` had been replayed, misrepresenting the
  // review flow this recording exists to demonstrate.
  //
  // Following the reducer means the replay shows what the operator saw, in the
  // order they saw it: nothing, then a proposal, then a grant.
  const view = cityViewFrom({
    state,
    scope: state.proposedScope ? scopeViewFromWire(state.proposedScope) : null,
    // A recording is a past mission; there is no countdown left to run on it.
    // Null renders no timer rather than a frozen or negative one.
    expiresIn: null,
    idleJob: record?.job ?? "No mission",
  });

  return { state, view, playing, record, verdict, error, play, stop };
}
