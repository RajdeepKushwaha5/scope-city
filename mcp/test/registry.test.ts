import { describe, expect, it } from "vitest";
import { resolverSafeFields } from "@scope-city/scope";
import { OFFICE_SPECS, grantableRegistry, officeRegistry } from "../src/registry.js";

/**
 * The free-text classification is a security control, not documentation.
 *
 * `resolverSafeFields` computes what the pre-grant resolver may read by
 * subtracting `freeTextFields` from `responseFields`. That subtraction is only
 * as good as the classification, and the dangerous failure is silent: a new
 * prose field that nobody classifies becomes readable before the scope exists,
 * and every test still passes.
 *
 * So the classification is asserted here rather than trusted.
 */
describe("office free-text classification", () => {
  it("classifies every field that carries prose an attacker can write", () => {
    // Named explicitly rather than pattern-matched. A regex over field names
    // would quietly stop covering a field called `note` or `memo`, which is the
    // exact drift this test exists to catch.
    const MUST_BE_FREE_TEXT: readonly [string, string][] = [
      ["ticket.get", "subject"],
      ["ticket.get", "body"],
      ["ticket.reply", "replies"],
      ["charge.get", "customer.address"],
      ["charge.get", "customer.history"],
      ["customer.list", "customers"],
      ["mail.list", "messages"],
    ];

    for (const [office, field] of MUST_BE_FREE_TEXT) {
      const spec = OFFICE_SPECS.find((s) => s.office === office);
      expect(spec, `${office} is not declared`).toBeDefined();
      expect(spec!.freeTextFields, `${office}.${field} must be free text`).toContain(field);
      expect(resolverSafeFields(spec!), `${office}.${field} must not be resolver-readable`)
        .not.toContain(field);
    }
  });

  it("declares no free-text field the office cannot actually return", () => {
    // A classification naming a field that does not exist is a typo that looks
    // like protection.
    for (const spec of OFFICE_SPECS) {
      for (const field of spec.freeTextFields) {
        expect(spec.responseFields, `${spec.office}.${field}`).toContain(field);
      }
    }
  });

  it("leaves the resolver enough to do its job", () => {
    // The other direction: over-classifying makes resolution impossible, and
    // "refund order #184" stops being derivable at all.
    const ticket = OFFICE_SPECS.find((s) => s.office === "ticket.get");
    const safe = resolverSafeFields(ticket!);
    expect(safe).toContain("order_id");
    expect(safe).toContain("customer_email");
  });

  it("keeps every mutating office out of the resolver's reach by construction", () => {
    // The resolver refuses mutating offices at run time; this asserts the set is
    // what we think it is, so that refusal is not silently covering for a spec
    // that has quietly become mutating.
    const mutating = OFFICE_SPECS.filter((s) => s.mutating).map((s) => s.office).sort();
    expect(mutating).toEqual(
      [
        "charge.refund",
        "mail.send",
        "ticket.close",
        "ticket.reply",
        // The Forge, behind GitHub's own MCP server. Listed here for the same
        // reason as the rest: an office that quietly becomes mutating should
        // fail this test rather than rely on the resolver noticing at run time.
        "issue.comment",
        "issue.close",
      ].sort(),
    );
  });
});

describe("what an operator can be offered", () => {
  /*
   * Grantable has to mean implemented, and by office rather than by district.
   *
   * Filtering by district would say "the Exchequer connected, so every
   * Exchequer office is grantable" -- and `stripeSystem()` implements a subset
   * of what the district registers, so a live Stripe run could derive a scope
   * holding `customer.list` and fail at the first call. The handlers know which
   * offices exist; district names only know which ones were declared.
   */

  it("does not offer an office nothing implements", () => {
    const grantable = grantableRegistry(["ticket.get", "charge.get"]);
    expect(grantable.has("issue.get")).toBe(false);
    expect(grantable.has("charge.refund")).toBe(false);
  });

  it("does not offer the rest of a district that is only partly implemented", () => {
    // The concrete case: the Exchequer is connected and `customer.list` still
    // has nothing behind it.
    const grantable = grantableRegistry(["charge.get", "charge.refund"]);
    expect(grantable.has("charge.get")).toBe(true);
    expect(grantable.has("customer.list")).toBe(false);
  });

  it("offers nothing at all when nothing is implemented", () => {
    // Absent configuration denies. There is deliberately no argument-less form
    // of this function, because "no list" must never read as "allow all".
    expect(grantableRegistry([]).size).toBe(0);
  });

  // --- and what it does offer ---------------------------------------------

  it("offers exactly the offices it was given", () => {
    const grantable = grantableRegistry(["issue.get", "mail.send"]);
    expect([...grantable.keys()].sort()).toEqual(["issue.get", "mail.send"]);
  });

  it("keeps the whole registry for the callers that mean the whole registry", () => {
    // The docs, the invariant tests and the offline fixtures are not enforcing
    // anything with it.
    expect(officeRegistry().size).toBe(OFFICE_SPECS.length);
  });
});
