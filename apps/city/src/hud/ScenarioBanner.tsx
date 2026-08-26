export type Scenario = "recorded" | "clean" | "poisoned" | "noscope";

/**
 * What this run is meant to show, while it is showing it.
 *
 * The scenario pills say which run started; they do not say what the viewer is
 * supposed to notice. Someone meeting this city for the first time has about
 * ten seconds to work out whether an agent stopping is the demo breaking or the
 * demo working -- and those look identical unless you were told in advance
 * which one to expect.
 *
 * So each scenario states its claim up front. That is a real commitment rather
 * than a caption: the banner says what will happen before it happens, so a run
 * that does something else is visibly a run that failed. A caption written
 * after the fact could never be wrong.
 */

interface Billing {
  readonly name: string;
  /** Stated before the run, so the run can contradict it. */
  readonly watchFor: string;
}

/*
 * Every claim below was checked against the script that actually runs.
 *
 * The first version of this table said the clean job "finishes inside its
 * scope". It does not: `CLEAN_JOB` ends by raising a gate and waiting for a
 * countersign. The banner was therefore promising an ending the run never
 * reaches -- which is precisely the failure this component exists to make
 * visible, committed in the component itself.
 *
 * Three of the four runs end at the Gate rather than at a finish, because an
 * irreversible call is the point of the demo. Saying so is not a hedge; a
 * viewer who expects completion reads a held gate as the demo hanging.
 */
const BILLING: Record<Scenario, Billing> = {
  recorded: {
    name: "Recorded run",
    watchFor:
      "A real mission, replayed from a hash-chained record. It stops at the Gate for a countersign before the refund.",
  },
  clean: {
    name: "Clean job",
    watchFor:
      "Nothing is refused, because nothing overreaches. The run still stops at the Gate, because the refund is irreversible.",
  },
  poisoned: {
    name: "Poisoned ticket",
    watchFor:
      "The ticket text tells the agent to do something else. Two calls are refused at the boundary, then the legitimate refund stops at the Gate.",
  },
  noscope: {
    name: "No scope",
    watchFor:
      "The same job with the authority an ordinary integration hands over. Nothing refuses anything, and the run ends failed.",
  },
};

export function ScenarioBanner(props: {
  scenario: Scenario | null;
  onDismiss: () => void;
}): React.JSX.Element | null {
  if (!props.scenario) return null;
  const billing = BILLING[props.scenario];

  return (
    /* `status` rather than `alert`: this is context for what is starting, not an
       interruption. `alert` would preempt a screen reader mid-sentence for text
       that is only ever scene-setting. */
    <div className="scenario-banner" role="status">
      <span className="scenario-banner__name">{billing.name}</span>
      <span className="scenario-banner__watch">{billing.watchFor}</span>
      <button
        className="scenario-banner__dismiss"
        onClick={props.onDismiss}
        aria-label="Dismiss scenario banner"
      >
        ✕
      </button>
    </div>
  );
}

export { BILLING as SCENARIO_BILLING };
