import type { RawDerivation } from "./derive.js";

/**
 * A derivation that needs no model.
 *
 * Two reasons this exists rather than always calling a model.
 *
 * The first is that a demo which cannot run without a live model key is a demo
 * that fails on someone else's laptop. Fixture mode has to produce a real
 * scope from a real sentence, or "scope derived from your words" is only true
 * when the network is.
 *
 * The second is that it gives the model something to be checked against. Both
 * paths feed `constrainEnvelope`, so the security properties are identical; the
 * difference is only how good the reading of the sentence is.
 *
 * It is a rule table, not a parser, and it is not trying to be clever. Verbs
 * map to the offices those verbs need, ids are pulled out by shape. Anything it
 * cannot understand produces fewer offices, which is the safe direction: the
 * agent is under-equipped rather than over-authorised.
 */

interface Rule {
  readonly match: RegExp;
  readonly offices: readonly string[];
}

/**
 * Each rule grants the whole chain its verb requires, because a job is not one
 * call. "Refund order #184" cannot be done with `charge.refund` alone -- an
 * order id is not a charge id, so the lookup offices come with it. Granting the
 * verb without its chain produces a scope that stops the agent halfway and
 * looks like the enforcement is broken when it is the scope that was wrong.
 */
const RULES: readonly Rule[] = [
  {
    match: /\brefunds?\b|\brefunded\b|\bmoney back\b|\breimburse/i,
    offices: ["ticket.get", "charge.find_by_order", "charge.get", "charge.refund"],
  },
  {
    match: /\bnotify\b|\bemail\b|\bmail\b|\btell\b|\blet .* know\b|\binform\b/i,
    offices: ["ticket.get", "mail.send"],
  },
  {
    match: /\breply\b|\brespond\b|\banswer\b/i,
    offices: ["ticket.get", "ticket.reply"],
  },
  {
    match: /\bclose\b|\bresolve\b|\bmark .* (done|closed)\b/i,
    offices: ["ticket.get", "ticket.close"],
  },
  {
    match: /\blook ?up\b|\bcheck\b|\bfind\b|\binspect\b|\bread\b/i,
    offices: ["ticket.get", "charge.find_by_order", "charge.get"],
  },
];

/**
 * Id extraction, by shape.
 *
 * Deliberately narrow. "#184" after the word "order" is an order; a bare number
 * with no noun attached is not treated as anything, because guessing which
 * resource class an unqualified number belongs to is how a scope ends up
 * granting the wrong record.
 */
const ID_PATTERNS: readonly { readonly cls: string; readonly re: RegExp }[] = [
  { cls: "order_ids", re: /\borders?\s*#?\s*([a-z0-9_-]{1,32})/gi },
  { cls: "ticket_ids", re: /\btickets?\s*#?\s*([a-z0-9_-]{1,32})/gi },
  { cls: "charge_ids", re: /\bcharges?\s*#?\s*([a-z0-9_-]{1,32})/gi },
];

/**
 * Whether a captured token is plausibly an id rather than the next English word.
 *
 * "Refund every order and email the customer list" put `and` straight after
 * `order`, and the pattern happily produced `ord_and` -- a resource grant
 * conjured out of grammar. Requiring a digit is crude but it is the property
 * that actually separates `184` and `ord_9f2` from `and`, `the`, `for`, and it
 * fails in the safe direction: a genuinely alphabetic id is not extracted, and
 * the operator is asked rather than guessed at.
 */
function plausibleId(raw: string): boolean {
  return /[0-9]/.test(raw);
}

/** Normalises `184`, `#184`, `ord_184` to the canonical `ord_184`. */
function canonical(cls: string, raw: string): string {
  const prefix = cls === "order_ids" ? "ord_" : cls === "ticket_ids" ? "tkt_" : "ch_";
  const bare = raw.replace(/^#/, "").toLowerCase();
  return bare.startsWith(prefix) ? bare : `${prefix}${bare}`;
}

/** Money in the sentence, as integer minor units. `$49`, `49.50`, `USD 49`. */
export function amountMinorIn(text: string): number | null {
  const m = /(?:\$|usd\s*|inr\s*|rs\.?\s*)([0-9]+(?:\.[0-9]{1,2})?)/i.exec(text);
  if (!m?.[1]) return null;
  // Parsed as a decimal string rather than a float multiply: 49.10 * 100 is
  // 4909.999999999999, and a ceiling that rounds down by a paisa refuses the
  // exact refund it was created to allow.
  const [whole, frac = ""] = m[1].split(".");
  return Number.parseInt(whole ?? "0", 10) * 100 + Number.parseInt(frac.padEnd(2, "0"), 10);
}

export function draftFromText(job: string): RawDerivation {
  const offices = new Set<string>();
  for (const rule of RULES) {
    if (rule.match.test(job)) for (const office of rule.offices) offices.add(office);
  }

  const named: Record<string, string[]> = {};
  for (const { cls, re } of ID_PATTERNS) {
    for (const match of job.matchAll(re)) {
      const id = match[1];
      if (!id || !plausibleId(id)) continue;
      named[cls] = [...new Set([...(named[cls] ?? []), canonical(cls, id)])];
    }
  }

  const amount = amountMinorIn(job);
  const maxAmountMinor: Record<string, number> = {};
  if (amount !== null && offices.has("charge.refund")) maxAmountMinor["charge.refund"] = amount;

  return { offices: [...offices], named, maxAmountMinor };
}

/**
 * The instruction given to a derivation turn.
 *
 * Exported so the demo can show the operator exactly what was asked, and so the
 * turn's total lack of tools is visible next to the prompt rather than buried
 * in an agent spec. Whatever comes back is still put through
 * `constrainEnvelope`, so this prompt is a request for a good draft, never a
 * security control.
 */
export function derivationPrompt(offices: readonly string[]): string {
  return [
    "You translate an operator's request into the minimum authority it needs.",
    "You have no tools and cannot look anything up. Work only from the sentence.",
    "",
    "Available offices:",
    ...offices.map((o) => `  ${o}`),
    "",
    "Reply with JSON only:",
    '{"offices":[],"named":{"order_ids":[],"ticket_ids":[]},"maxAmountMinor":{},"maxCalls":{},"ttlMs":600000}',
    "",
    "Rules:",
    "- Fewest offices that can finish the job. Include lookups the job depends on.",
    "- `named` holds only ids the operator actually stated. Never invent one.",
    "- A charge id cannot be derived from an order id. Leave charge_ids out.",
    "- Amounts are integer minor units: $49 is 4900.",
  ].join("\n");
}
