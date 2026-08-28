import { randomBytes } from "node:crypto";
import type { HarnessDriver } from "@scope-city/harness";
import { initialState, translate, type TurnEvent, type WorldEvent } from "@scope-city/harness";
import type { CountersignBook } from "@scope-city/mission";
import type { Scope } from "@scope-city/scope";

/**
 * Runs a mission to completion across however many turns it takes.
 *
 * A single `runTurn` is not a mission. When TrueForge gates a tool it emits
 * `tool.approval_required` and **ends the stream** -- the turn is paused, not
 * blocked -- and the refund never happens unless something starts a new turn
 * carrying the approval. Consuming one stream and stopping produces a mission
 * that always halts one step before the interesting part.
 *
 * So this is a loop: run a turn, collect whatever it gated, ask the operator,
 * resume with their answers, repeat until nothing is pending.
 */

export interface GateRequest {
  readonly threadId: string;
  readonly toolCallId: string;
  readonly office: string | null;
  readonly args: Record<string, unknown>;
}

export interface MissionRunOptions {
  readonly driver: HarnessDriver;
  readonly sessionId: string;
  readonly scope: Scope;
  readonly book: CountersignBook;
  readonly prompt: string;
  /** Decides a gate. The city shows a dialog; the headless demo scripts it. */
  readonly decide: (gate: GateRequest) => Promise<{ approved: boolean; reason?: string }>;
  readonly onEvent: (event: WorldEvent) => void;
  readonly onRaw?: (event: TurnEvent) => void;
  /** Guards against a model that gates forever. */
  readonly maxTurns?: number;
  /**
   * Carry on an interrupted session rather than starting the job again.
   *
   * A rate limit ends the turn, not the session: TrueForge keeps the
   * conversation, so the agent still knows every record it has read and every
   * check it has run. Re-sending the brief would make it start from nothing on
   * a session that already holds the work.
   *
   * Set when the control plane is retrying after waiting out a cooling key.
   */
  readonly resuming?: boolean;
}

export interface MissionResult {
  readonly status: string;
  readonly message?: string;
  readonly turns: number;
  readonly gates: number;
}

export async function runMission(options: MissionRunOptions): Promise<MissionResult> {
  const { driver, sessionId, scope, book, decide, onEvent, onRaw } = options;
  const maxTurns = options.maxTurns ?? 8;

  let translator = initialState();
  let pending: GateRequest[] = [];
  let status = "unknown";
  let message: string | undefined;
  let turns = 0;
  let gates = 0;

  const consume = async (stream: AsyncGenerator<TurnEvent, void, undefined>) => {
    pending = [];

    for await (const event of stream) {
      onRaw?.(event);

      if (event.type === "turn.done") {
        const turnState = (event as { state?: { status?: string; message?: string } }).state;
        status = turnState?.status ?? "unknown";
        message = turnState?.message;
      }

      const result = translate(event, translator, Date.now());
      translator = result.state;

      for (const worldEvent of result.events) {
        onEvent(worldEvent);

        if (worldEvent.type === "gate.raised") {
          gates += 1;

          // Fingerprint what TrueForge is *showing the operator*. The proxy
          // will later fingerprint what it is *about to run*, and the two must
          // agree. Raising from the proxy's own request instead would make the
          // check tautological -- it would approve itself.
          if (worldEvent.office) {
            book.raise({
              scope,
              toolCallId: worldEvent.toolCallId,
              threadId: worldEvent.threadId,
              office: worldEvent.office,
              args: (worldEvent.args ?? {}) as Record<string, unknown>,
              now: Date.now(),
            });
          }

          pending.push({
            threadId: worldEvent.threadId,
            toolCallId: worldEvent.toolCallId,
            office: worldEvent.office,
            args: (worldEvent.args ?? {}) as Record<string, unknown>,
          });
        }
      }
    }
  };

  // A nudge, not the brief, when picking a session back up. The agent has the
  // job and everything it has already established; what it needs is to be told
  // to carry on rather than to be handed the task a second time.
  const opening = options.resuming
    ? "You were interrupted. Continue from where you stopped. Do not repeat work you have already done."
    : options.prompt;

  await consume(driver.runTurn(sessionId, [{ type: "user.message", content: opening }]));
  turns += 1;

  while (pending.length > 0 && turns < maxTurns) {
    const answered = await Promise.all(
      pending.map(async (gate) => {
        const verdict = await decide(gate);
        book.settle(gate.toolCallId, {
          status: verdict.approved ? "approved" : "denied",
          ...(verdict.reason ? { reason: verdict.reason } : {}),
          at: Date.now(),
        } as never);
        return { ...gate, ...verdict };
      }),
    );

    await consume(
      driver.resume(
        sessionId,
        answered.map((a) => ({
          threadId: a.threadId,
          toolCallId: a.toolCallId,
          approved: a.approved,
          ...(a.reason ? { reason: a.reason } : {}),
        })),
      ),
    );
    turns += 1;
  }

  return { status, ...(message ? { message } : {}), turns, gates };
}

/**
 * A per-mission bearer token for the proxy.
 *
 * The mission id in the URL is a capability, but the demo binds the proxy to
 * 0.0.0.0 so the harness can reach it from another network namespace -- which
 * means anything else on the network can reach it too. A URL that leaks into a
 * log should not be enough to spend someone's refund budget, so the harness is
 * registered with a header and the proxy requires it.
 */
export function newProxyToken(): string {
  return randomBytes(32).toString("base64url");
}
