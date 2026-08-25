import {
  MissionEventLog,
  type CityFeedEvent,
  type LoggedEvent,
  type Replay,
} from "@scope-city/mission";
import type { GateRequest } from "./mission-run.js";

export type FeedListener = (entry: LoggedEvent<CityFeedEvent>) => void;

/** Replayable fan-out between one live mission and any number of city tabs. */
export class MissionFeed {
  readonly #log: MissionEventLog<CityFeedEvent>;
  readonly #listeners = new Set<FeedListener>();

  constructor(capacity = 5_000) {
    this.#log = new MissionEventLog(capacity);
  }

  append(event: CityFeedEvent, at = Date.now()): LoggedEvent<CityFeedEvent> {
    const entry = this.#log.append(event, at);
    for (const listener of this.#listeners) listener(entry);
    return entry;
  }

  since(cursor: number): Replay<CityFeedEvent> {
    return this.#log.since(cursor);
  }

  /** True when the log has dropped events, so a record built from it has a gap. */
  get lossy(): boolean {
    return this.#log.lossy;
  }

  subscribe(listener: FeedListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Atomically joins the live fan-out before taking the replay snapshot.
   * JavaScript cannot interleave an append between these synchronous steps,
   * so the caller receives every event either in `replay` or via `listener`.
   */
  subscribeFrom(cursor: number, listener: FeedListener): {
    readonly replay: Replay<CityFeedEvent>;
    readonly unsubscribe: () => void;
  } {
    const unsubscribe = this.subscribe(listener);
    return { replay: this.since(cursor), unsubscribe };
  }
}

export interface GateDecision {
  readonly approved: boolean;
  readonly reason?: string;
}

interface WaitingGate {
  readonly gate: GateRequest;
  readonly resolve: (decision: GateDecision) => void;
  readonly promise: Promise<GateDecision>;
}

/** A visible operator decision, not an automatic approval disguised as one. */
export class OperatorGateQueue {
  readonly #waiting = new Map<string, WaitingGate>();

  wait(gate: GateRequest): Promise<GateDecision> {
    const existing = this.#waiting.get(gate.toolCallId);
    if (existing) return existing.promise;

    let settle!: (decision: GateDecision) => void;
    const promise = new Promise<GateDecision>((resolve) => {
      settle = resolve;
    });
    this.#waiting.set(gate.toolCallId, { gate, resolve: settle, promise });
    return promise;
  }

  decide(toolCallId: string, decision: GateDecision): boolean {
    const waiting = this.#waiting.get(toolCallId);
    if (!waiting) return false;
    this.#waiting.delete(toolCallId);
    waiting.resolve(decision);
    return true;
  }

  cancelAll(reason = "mission cancelled"): void {
    for (const [toolCallId, waiting] of this.#waiting) {
      this.#waiting.delete(toolCallId);
      waiting.resolve({ approved: false, reason });
    }
  }

  list(): readonly GateRequest[] {
    return [...this.#waiting.values()].map((entry) => entry.gate);
  }
}
