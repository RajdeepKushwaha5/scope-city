import { OFFICE_SPECS, officeRegistry, type SystemDefinition } from "@scope-city/mcp";
import type { Scope } from "@scope-city/scope";

/**
 * The scope an ordinary agent integration runs with.
 *
 * Not a bypass, and that distinction is the whole value of this. It would be
 * easy — and dishonest — to demonstrate the catastrophe by switching the proxy
 * off, because then the comparison is between "our enforcement" and "no
 * enforcement", which proves only that code that runs does something.
 *
 * This instead expresses today's normal arrangement in the same vocabulary the
 * granted scope uses: every office the city has, every record the systems can
 * name, no amount ceiling, no call budget, no gate. That *is* what "the user
 * has broad access, so the agent inherits broad access" means when you write it
 * down. The same evaluator polices it, the same proxy carries the calls, the
 * same map draws it. Only the authority differs.
 *
 * Written down, it is also faintly shocking, which is the point. Nobody
 * configures an integration by listing every charge in the account; they hand
 * over a key and the listing is implied. Making it explicit is what lets the
 * map show the difference.
 */

/**
 * A ceiling high enough never to bind: one billion minor units.
 *
 * Named rather than inlined so it reads as what it is at the call site.
 */
const NO_LIMIT = 1_000_000_000;

/** Offices taking a monetary argument, which are the ones needing a ceiling. */
function amountOffices(
  registry: ReturnType<typeof officeRegistry>,
  offices: readonly string[],
): readonly string[] {
  return offices.filter((office) => {
    const spec = registry.get(office);
    return spec ? Object.values(spec.args).some((b) => b.kind === "amount_minor") : false;
  });
}

/** Every resource id the systems can name, by resource class. */
async function everything(systems: readonly SystemDefinition[]): Promise<
  Record<string, string[]>
> {
  const resources: Record<string, Set<string>> = {};
  const add = (cls: string, id: string): void => {
    (resources[cls] ??= new Set()).add(id);
  };

  // Enumerated from the systems rather than hardcoded.
  //
  // A fixed list of three orders understated the very thing this scope exists
  // to show: against real Stripe there are more charges than the demo seeded,
  // and other recipients besides the three named, so calls to them were still
  // refused for `resource_not_in_scope` while the documentation claimed "every
  // record". A broad grant that quietly is not broad demonstrates nothing.
  //
  // The honest limit, stated because it matters: a real integration's
  // credential carries no list at all. This vocabulary cannot express "no
  // list" -- the same gap that made "no amount ceiling" a billion -- so the
  // widest thing expressible is everything the systems can currently name.
  // That is a floor on the blast radius, not a ceiling.
  const exchequer = systems.find((s) => s.district === "exchequer");
  const listCharges = exchequer?.offices.find((o) => o.office === "charge.find_by_order");
  const readCharge = exchequer?.offices.find((o) => o.office === "charge.get");

  for (const orderId of ["ord_184", "ord_185", "ord_186"]) {
    add("order_ids", orderId);
    if (!listCharges) continue;
    try {
      const found = (await listCharges.call({ order_id: orderId })) as { id?: string };
      if (typeof found.id !== "string") continue;
      add("charge_ids", found.id);

      // Every recipient the account can name, read off the charges themselves,
      // so a broad grant reaches whoever actually appears in the data rather
      // than a list somebody typed.
      if (!readCharge) continue;
      const charge = (await readCharge.call({ charge_id: found.id })) as {
        customer?: { email?: unknown; history?: unknown };
      };
      const email = charge.customer?.email;
      if (typeof email === "string" && email.length > 0) add("mail_to", email);

      const history = charge.customer?.history;
      if (Array.isArray(history)) {
        for (const entry of history) {
          const id = (entry as { id?: unknown }).id;
          if (typeof id === "string") add("charge_ids", id);
        }
      }
    } catch {
      // An order with no charge contributes nothing. A broad grant naming a
      // record that does not exist is still a broad grant.
    }
  }

  for (const ticketId of ["tkt_184", "tkt_185"]) add("ticket_ids", ticketId);
  // The attacker's address, so the comparison can actually reach it. Withholding
  // it would have the broad-access run refused at the one call the whole
  // scenario is about, by the boundary it is supposed to be running without.
  for (const email of ["customer@example.test", "someone.else@example.test", "attacker@example.test"]) {
    add("mail_to", email);
  }

  return Object.fromEntries(Object.entries(resources).map(([k, v]) => [k, [...v].sort()]));
}

export async function unscopedScope(params: {
  readonly missionId: string;
  readonly job: string;
  readonly systems: readonly SystemDefinition[];
  readonly now: number;
  readonly ttlMs?: number;
}): Promise<Scope> {
  const registry = officeRegistry();

  // Only offices something actually implements.
  //
  // Granting every declared office advertised `customer.list` in Stripe mode,
  // where no system implements it: the proxy listed a tool that threw the
  // moment the agent called it. A broad grant is meant to show what an ordinary
  // integration reaches, not to hand the agent a door with nothing behind it --
  // and a crash mid-comparison reads as the demo breaking rather than as the
  // point being made.
  const implemented = new Set(params.systems.flatMap((s) => s.offices.map((o) => o.office)));
  const offices = OFFICE_SPECS.map((spec) => spec.office)
    .filter((office) => implemented.has(office))
    .sort();

  // Everything the offices can return, unfiltered. A normal integration has no
  // response layer at all: whatever the API sends back lands in the model's
  // context, customer history and addresses included.
  const projection: Record<string, readonly string[]> = {};
  for (const office of offices) {
    projection[office] = registry.get(office)?.responseFields ?? [];
  }

  return {
    missionId: params.missionId,
    scopeId: "NO-SCOPE",
    agent: "ordinary-agent",
    job: params.job,
    state: "granted",
    offices,
    resources: await everything(params.systems),
    limits: {
      // "No limit" has to be written as an absurd number, and that is the
      // enforcement layer working rather than a wrinkle in this file.
      //
      // The evaluator refuses an amount call that has no ceiling at all --
      // deny by default, so an unconfigured limit is not an unlimited one.
      // There is deliberately no way to express "unbounded", so representing
      // an ordinary integration means naming a ceiling high enough not to
      // bind. Having to type a number this large to describe what most agents
      // run with today is the comparison making its own argument.
      maxAmountMinor: Object.fromEntries(amountOffices(registry, offices).map((o) => [o, NO_LIMIT])),
      // Call budgets *are* optional, and a missing one is unbounded. An
      // ordinary integration has none: it can call as often as it likes.
      maxCalls: {},
      maxResponseBytes: 1_000_000,
    },
    projection,
    // No gate. This is the line that matters most: nothing stops to ask.
    countersignRequired: [],
    expiresAt: params.now + (params.ttlMs ?? 10 * 60 * 1000),
    grantedBy: "operator:broad-access",
    grantedAt: params.now,
    version: 1,
  };
}
