import { describe, expect, it } from "vitest";
import { crewFrom, outsideScope, ROOT_THREAD } from "./crew.js";
import type { Figure } from "./render/scene.js";

const team = (id: string, title: string | null): Figure => ({
  id,
  u: 0,
  v: 0,
  kind: "team",
  title,
});

const SOURCE = team("th-1", "Source investigator");
const TARGET = team("th-2", "Target verifier");

describe("who is in the field", () => {
  it("says nothing has been delegated when nothing has", () => {
    // The panel hides itself on this. One thread bound by one scope is not an
    // observation worth a window during a mission.
    const crew = crewFrom([], { [ROOT_THREAD]: ["ticket.get"] });

    expect(crew.delegated).toBe(0);
    expect(crew.members).toHaveLength(1);
    expect(crew.members[0]?.isRoot).toBe(true);
  });

  it("lists the root first, whatever order the threads arrived in", () => {
    // Two runs of the same mission should not look like different missions,
    // and the root is the thread the operator actually granted to.
    const crew = crewFrom([TARGET, SOURCE], {});

    expect(crew.members[0]?.isRoot).toBe(true);
    expect(crew.members.map((m) => m.title)).toEqual([
      "Root agent",
      "Target verifier",
      "Source investigator",
    ]);
  });

  it("keeps a worker that has finished and left the map", () => {
    // The moment an operator most wants to read this is the gate, which comes
    // after the readers are done. Dropping them on `field.left` would empty the
    // panel at exactly the wrong time.
    const crew = crewFrom([], { [ROOT_THREAD]: [], "th-1": ["ticket.get"] });

    const worker = crew.members.find((m) => m.threadId === "th-1");
    expect(worker?.offices).toEqual(["ticket.get"]);
    expect(worker?.active).toBe(false);
  });

  it("marks a worker still on the map as working", () => {
    const crew = crewFrom([SOURCE], { "th-1": ["ticket.get"] });

    expect(crew.members.find((m) => m.threadId === "th-1")?.active).toBe(true);
  });

  it("keeps the title after the worker has left the field", () => {
    // The defect this caught, found by rendering the shipped recording rather
    // than by reasoning about it: `field.left` removes the figure and the title
    // went with it, so the panel read at the gate -- which is after the workers
    // finish -- showed two anonymous rows. The names are the evidence that the
    // delegation was purposeful, so they have to outlive the figure.
    const crew = crewFrom([], { "th-1": ["charge.get"] }, { "th-1": "Target verifier" });

    expect(crew.members.find((m) => m.threadId === "th-1")?.title).toBe("Target verifier");
  });

  it("prefers the live figure's title to the recorded one", () => {
    const crew = crewFrom([team("th-1", "Renamed")], {}, { "th-1": "Original" });

    expect(crew.members.find((m) => m.threadId === "th-1")?.title).toBe("Renamed");
  });

  it("names a thread the harness did not title", () => {
    // Titles come from the model by way of the brief, so they are real and
    // occasionally absent. An untitled thread still has to be nameable.
    const crew = crewFrom([team("th-9", null)], {});

    expect(crew.members.find((m) => m.threadId === "th-9")?.title).toBe("Field team");
  });

  it("collects what the workers reached, without the root's own calls", () => {
    // The claim the panel makes is about the delegated work specifically.
    // Folding the root's calls in would make the sentence true but unfalsifiable.
    const crew = crewFrom([SOURCE, TARGET], {
      [ROOT_THREAD]: ["charge.refund"],
      "th-1": ["ticket.get"],
      "th-2": ["charge.get", "ticket.get"],
    });

    expect(crew.delegated).toBe(2);
    expect(crew.delegatedOffices).toEqual(["ticket.get", "charge.get"]);
    expect(crew.delegatedOffices).not.toContain("charge.refund");
  });
});

describe("whether a worker reached outside the scope", () => {
  /** Everything the proxy judges. Anything else is the harness's own tool. */
  const SERVED = ["ticket.get", "charge.get", "charge.refund", "mail.send"];

  const crew = crewFrom([SOURCE, TARGET], {
    "th-1": ["ticket.get"],
    "th-2": ["charge.get"],
  });

  it("finds nothing when every call was granted", () => {
    expect(outsideScope(crew, ["ticket.get", "charge.get", "charge.refund"], SERVED)).toEqual([]);
  });

  it("names the office when one was not", () => {
    // The assertion that makes the panel worth reading. It is computed rather
    // than typed, so if the boundary ever does have a hole the city says so
    // instead of going on reassuring people.
    expect(outsideScope(crew, ["ticket.get"], SERVED)).toEqual(["charge.get"]);
  });

  it("reports every office that was not granted, not just the first", () => {
    expect(outsideScope(crew, [], SERVED)).toEqual(["ticket.get", "charge.get"]);
  });

  it("is not satisfied by an office granted to nobody", () => {
    // A scope naming an office the workers never touched proves nothing about
    // the ones they did.
    expect(outsideScope(crew, ["mail.send"], SERVED)).toEqual(["ticket.get", "charge.get"]);
  });

  it("does not call a harness tool a breach", () => {
    // Subagents share the root's sandbox, so a worker running a check calls
    // `exec` -- which never reaches the proxy and was never in anyone's scope.
    // Flagging it would have the city announce a hole in the boundary the first
    // time a delegated worker verified something, which is the opposite of the
    // behaviour this panel exists to demonstrate.
    const withSandbox = crewFrom([SOURCE], { "th-1": ["ticket.get", "exec", "create_sub_agent"] });

    expect(outsideScope(withSandbox, ["ticket.get"], SERVED)).toEqual([]);
  });

  it("still catches a real breach beside a harness tool", () => {
    const mixed = crewFrom([SOURCE], { "th-1": ["exec", "charge.refund"] });

    expect(outsideScope(mixed, ["ticket.get"], SERVED)).toEqual(["charge.refund"]);
  });
});
