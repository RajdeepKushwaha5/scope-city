import type { Figure } from "./render/scene.js";

/**
 * Who is in the field, and what each of them was allowed to do.
 *
 * The city already draws a figure per thread, which proves delegation happened.
 * It does not answer the question delegation actually raises, and it is the
 * question worth answering: *if the agent can create workers at runtime, what
 * stops one of them doing something the operator never approved?*
 *
 * The answer is that nothing about a subagent is negotiated separately. A child
 * thread inherits the session's tools and reaches the same proxy, so it is
 * judged against the same sealed scope as the thread that spawned it. There is
 * no per-subagent permission to get wrong, because there is no per-subagent
 * permission at all -- which is a stronger property than a careful set of them,
 * and invisible unless something says so.
 *
 * TrueForge subagents are dynamic and one level deep: the root agent calls
 * `create_sub_agent` while it works, and the children cannot spawn their own.
 * So the shape here is deliberately flat -- a root and its workers, never a
 * tree -- because drawing a tree would imply a depth the harness does not have.
 */

/** The root agent's thread. TrueForge names it, and every mission has exactly one. */
export const ROOT_THREAD = "main";

export interface CrewMember {
  readonly threadId: string;
  /**
   * What the harness called this thread, or what to call it when it did not.
   *
   * Titles come from the brief by way of the model -- "Source investigator",
   * "Target verifier" -- so they are real, and occasionally absent. A thread
   * with no title still has to be nameable in a list.
   */
  readonly title: string;
  readonly isRoot: boolean;
  /** Offices this thread reached, in the order it first reached them. */
  readonly offices: readonly string[];
  /** Still working, as far as the feed knows. */
  readonly active: boolean;
}

export interface CrewView {
  readonly members: readonly CrewMember[];
  /** How many of them are subagents rather than the root. */
  readonly delegated: number;
  /**
   * Offices reached by any subagent, deduplicated.
   *
   * The point of the panel: every one of these was judged against the same
   * scope the operator granted the root, so the set can be checked against the
   * city limits by eye.
   */
  readonly delegatedOffices: readonly string[];
}

/**
 * Builds the crew from what the feed already tracks.
 *
 * `figures` is the set of live threads the map is drawing; `work` is the
 * offices each thread reached; `titled` is what the harness called each thread
 * when it joined. All three are separate because a thread leaves the field when
 * it finishes while what it did and what it was called both stay true -- and a
 * panel that dropped either at that moment would go blank at exactly the point
 * the operator wants to read it, which is the gate.
 */
export function crewFrom(
  figures: readonly Figure[],
  work: Readonly<Record<string, readonly string[]>>,
  titled: Readonly<Record<string, string | null>> = {},
): CrewView {
  const live = new Set(figures.filter((figure) => figure.kind === "team").map((f) => f.id));
  // The figure's title first, then the one recorded when the thread joined.
  // A worker that has finished is no longer a figure, and its title is the
  // evidence that the delegation was purposeful -- so it has to outlive it.
  const titles = new Map<string, string | null>(Object.entries(titled));
  for (const figure of figures) {
    if (figure.title) titles.set(figure.id, figure.title);
  }

  // Every thread that has either appeared on the map or done something. A
  // subagent that finished before this was read still belongs in the list.
  const ids = [...new Set([ROOT_THREAD, ...figures.map((f) => f.id), ...Object.keys(work)])];

  const members = ids
    .filter((id) => id === ROOT_THREAD || live.has(id) || (work[id]?.length ?? 0) > 0)
    .map((id): CrewMember => {
      const isRoot = id === ROOT_THREAD;
      return {
        threadId: id,
        title: titles.get(id) ?? (isRoot ? "Root agent" : "Field team"),
        isRoot,
        offices: work[id] ?? [],
        active: isRoot ? true : live.has(id),
      };
    })
    // Root first, then the order the harness created them, which is the order
    // the map drew them in. Sorting by name instead would make two runs of the
    // same mission look like different missions.
    .sort((a, b) => Number(b.isRoot) - Number(a.isRoot));

  const delegated = members.filter((member) => !member.isRoot);

  return {
    members,
    delegated: delegated.length,
    delegatedOffices: [...new Set(delegated.flatMap((member) => member.offices))],
  };
}

/**
 * Whether a subagent reached an office the scope does not name.
 *
 * Should always be empty, and is computed rather than asserted for that exact
 * reason: a panel claiming "all within scope" because someone typed the words
 * is worth nothing. If this ever returns an office, the boundary has a hole and
 * the city should say so rather than go on reassuring people.
 *
 * `served` is what the proxy actually judges. Anything else a thread calls --
 * `create_sub_agent`, `exec` -- is the harness's own tool and never reaches the
 * boundary at all, so it is neither granted nor refused and must not be
 * reported as a breach. Subagents share the root's sandbox, so a worker running
 * a check is ordinary and would otherwise have raised a false alarm saying the
 * scope had been broken.
 */
export function outsideScope(
  crew: CrewView,
  granted: readonly string[],
  served: readonly string[],
): readonly string[] {
  const allowed = new Set(granted);
  const judged = new Set(served);
  return crew.delegatedOffices.filter((office) => judged.has(office) && !allowed.has(office));
}
