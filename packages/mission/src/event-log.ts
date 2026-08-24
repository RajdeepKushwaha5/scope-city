import type { WorldEvent } from "@scope-city/harness";

/**
 * An append-only log of everything that happened in a mission.
 *
 * This is what makes a reconnect work. TrueForge keeps the *session* alive
 * across a refresh or a restart, but a browser that reconnects has no idea what
 * it missed, and re-running the mission to find out is not an option -- the
 * refund already happened.
 *
 * So the log is the answer to "what did I miss": a client says where it got to
 * and gets everything since. Because `MissionOrchestrator` owns no I/O, replaying
 * that slice reconstructs exactly the same city, which is a property we test
 * rather than hope for.
 *
 * Sequence numbers are per mission and start at 1. Zero means "I have nothing",
 * which is the honest thing for a fresh client to say and avoids the off-by-one
 * that comes from treating "no events" and "event zero" as the same.
 */

export interface LoggedEvent {
  readonly sequence: number;
  readonly event: WorldEvent;
  readonly at: number;
}

export interface Replay {
  readonly events: readonly LoggedEvent[];
  /** The sequence a client should send next time. */
  readonly cursor: number;
  /**
   * True when the client asked for events that have been dropped, and should
   * discard its state and take the whole log instead of stitching a gap.
   */
  readonly truncated: boolean;
}

export class MissionEventLog {
  readonly #events: LoggedEvent[] = [];
  readonly #capacity: number;
  #dropped = 0;

  /**
   * `capacity` bounds memory on a long-running demo. Older events fall off the
   * front, and a client that asks for one of them is told so rather than being
   * handed a stream with a hole in it.
   */
  constructor(capacity = 5_000) {
    this.#capacity = capacity;
  }

  append(event: WorldEvent, at: number = Date.now()): LoggedEvent {
    const sequence = this.#dropped + this.#events.length + 1;
    const logged: LoggedEvent = { sequence, event, at };
    this.#events.push(logged);

    if (this.#events.length > this.#capacity) {
      this.#events.shift();
      this.#dropped += 1;
    }

    return logged;
  }

  /**
   * Everything after `cursor`.
   *
   * A client that has nothing passes 0 and gets the whole log. A client that
   * has seen up to N passes N and gets N+1 onward.
   */
  since(cursor: number): Replay {
    const oldest = this.#dropped + 1;
    const truncated = cursor > 0 && cursor + 1 < oldest;

    const events = this.#events.filter((e) => e.sequence > (truncated ? 0 : cursor));

    return {
      events,
      cursor: this.latest,
      truncated,
    };
  }

  get latest(): number {
    return this.#dropped + this.#events.length;
  }

  get size(): number {
    return this.#events.length;
  }

  /** True when events have been discarded and a full replay is no longer possible. */
  get lossy(): boolean {
    return this.#dropped > 0;
  }
}
