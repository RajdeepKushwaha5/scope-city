import { translate, type TranslatorState, type TurnEvent, type WorldEvent } from "@scope-city/harness";
import { initialState } from "@scope-city/harness";
import type { Scope } from "@scope-city/scope";
import { CountersignBook, type Verdict } from "./countersign-book.js";

/**
 * Runs one mission.
 *
 * Three streams have to be reconciled and none of them knows about the others:
 * the harness emits turn events, the proxy emits enforcement events, and the
 * operator issues verdicts. The orchestrator is the only place holding all
 * three, which makes it the only place that can bind an approval to the call it
 * was granted for.
 *
 * It owns no I/O. Feed it events, ask it questions -- which keeps a whole
 * mission replayable in a test, including the parts that would otherwise need a
 * live harness and a human.
 */

export type MissionPhase =
  | "drafting"
  | "awaiting_grant"
  | "running"
  | "awaiting_countersign"
  | "done"
  | "failed";

export interface MissionSnapshot {
  readonly phase: MissionPhase;
  readonly scope: Scope | null;
  readonly gatesOpen: number;
  readonly districts: readonly string[];
  readonly fieldSize: number;
  readonly sandboxOpen: boolean;
}

export class MissionOrchestrator {
  readonly #book = new CountersignBook();
  readonly #districts = new Set<string>();
  readonly #field = new Set<string>();
  readonly #emit: (event: WorldEvent) => void;

  #translator: TranslatorState = initialState();
  #scope: Scope | null = null;
  #phase: MissionPhase = "drafting";
  #sandboxOpen = false;

  constructor(options: { emit: (event: WorldEvent) => void }) {
    this.#emit = options.emit;
  }

  get book(): CountersignBook {
    return this.#book;
  }

  get scope(): Scope | null {
    return this.#scope;
  }

  /**
   * The operator grants a scope. Until this happens the mission is drafting and
   * the proxy has nothing to enforce, so nothing the agent asks for can succeed.
   */
  grant(scope: Scope): void {
    this.#scope = scope;
    this.#phase = "running";
  }

  revoke(): void {
    if (this.#scope) {
      this.#scope = { ...this.#scope, state: "revoked", version: this.#scope.version + 1 };
    }
  }

  /**
   * Feeds one harness event through translation and updates what the city knows.
   *
   * Gates are the interesting case: the harness tells us a human is needed, but
   * the arguments it carries are what the operator will read, so this is the
   * moment the fingerprint has to be taken. Take it later and the call may have
   * changed; take it earlier and there is nothing to take it from.
   */
  ingest(event: TurnEvent, now: number = Date.now()): readonly WorldEvent[] {
    const { state, events } = translate(event, this.#translator, now);
    this.#translator = state;

    for (const worldEvent of events) {
      this.#apply(worldEvent, now);
      this.#emit(worldEvent);
    }

    return events;
  }

  #apply(event: WorldEvent, now: number): void {
    switch (event.type) {
      case "district.online":
        this.#districts.add(event.district);
        break;

      case "field.joined":
        this.#field.add(event.threadId);
        break;

      case "field.left":
        this.#field.delete(event.threadId);
        break;

      case "yard.opened":
        this.#sandboxOpen = true;
        break;

      case "gate.raised": {
        // No scope means no fingerprint is possible, and a gate we cannot bind
        // is a gate we must not honour later.
        if (!this.#scope || !event.office) break;
        this.#book.raise({
          scope: this.#scope,
          toolCallId: event.toolCallId,
          threadId: event.threadId,
          office: event.office,
          args: (event.args ?? {}) as Record<string, unknown>,
          now,
        });
        this.#phase = "awaiting_countersign";
        break;
      }

      case "mission.ended":
        this.#phase = event.status === "done" ? "done" : "failed";
        break;

      default:
        break;
    }
  }

  /**
   * Records the operator's decision and reports what has to go back to the
   * harness to unpause the turn.
   *
   * The caller sends this as the input to a *new* turn -- the harness has no
   * callback to answer, which is why this returns a description rather than
   * performing anything itself.
   */
  decide(params: {
    toolCallId: string;
    approved: boolean;
    reason?: string;
    now?: number;
  }): { threadId: string; toolCallId: string; approved: boolean; reason?: string } | undefined {
    const { toolCallId, approved, reason } = params;
    const now = params.now ?? Date.now();

    const pending = this.#book.pending(toolCallId);
    if (!pending) return undefined;

    const verdict: Verdict = approved
      ? { status: "approved", at: now }
      : { status: "denied", reason, at: now };

    this.#book.settle(toolCallId, verdict);

    this.#emit({ type: "gate.cleared", toolCallId, approved, at: now });

    if (this.#book.allPending().every((p) => p.toolCallId === toolCallId)) {
      this.#phase = "running";
    }

    return { threadId: pending.threadId, toolCallId, approved, reason };
  }

  snapshot(): MissionSnapshot {
    return {
      phase: this.#phase,
      scope: this.#scope,
      gatesOpen: this.#book.allPending().length,
      districts: [...this.#districts],
      fieldSize: this.#field.size,
      sandboxOpen: this.#sandboxOpen,
    };
  }
}
