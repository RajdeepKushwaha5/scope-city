/**
 * Reading a pass or fail out of sandbox output.
 *
 * Lives here rather than beside the brief that asks for the check, because the
 * brief is prose and this is parsing: it reads what a tool returned, which is
 * this package's job. It also has to, since the harness translates tool
 * responses and cannot import the package that depends on it.
 *
 * Two signals, in order of how much they actually mean.
 *
 * The sandbox returns a structured envelope, and its exit code is the honest
 * answer. A verification script asserts and then prints; if an assertion fails
 * the process dies non-zero, so exit status already carries the verdict the
 * script was written to produce. Reading prose first got this exactly wrong in
 * practice: a real run printed "Verdict: Ready to refund." with exit code 0 and
 * was marked failed, because that sentence contains none of the words a text
 * matcher looks for. Blocking an approval on a check that passed is the same
 * class of error as allowing one that failed -- it teaches the operator the
 * gate is noise.
 *
 * Text matching survives as a fallback for output that carries no envelope, and
 * stays strict there: anything not clearly a pass is a fail, because a
 * verification whose result cannot be read is not a verification, and
 * defaulting to "probably fine" where a human is relying on the check would be
 * the worst possible default.
 */

/** Failure words that override even a zero exit code. */
const FAILURE = /\b(fail|failed|mismatch|traceback|assertionerror)\b/i;

/** Words that read as a pass when there is no exit code to consult. */
const SUCCESS = /\b(ok|pass|passed|match|matches|verified|ready)\b/i;

interface SandboxEnvelope {
  readonly exitCode: number;
  readonly text: string;
}

/**
 * The exit code and result text out of a sandbox response, if it has them.
 *
 * Shapes vary between harness versions, so the envelope is searched for rather
 * than assumed: `{response:{exitCode,result}}` and a flat `{exitCode,result}`
 * both appear. Anything unrecognised returns null and falls through to text.
 */
export function sandboxEnvelope(output: string): SandboxEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const root = parsed as Record<string, unknown>;
  const inner = (typeof root["response"] === "object" && root["response"] !== null
    ? (root["response"] as Record<string, unknown>)
    : root) as Record<string, unknown>;

  const code = inner["exitCode"] ?? inner["exit_code"];
  if (typeof code !== "number") return null;

  const result = inner["result"] ?? inner["stdout"] ?? inner["output"];
  return { exitCode: code, text: typeof result === "string" ? result : "" };
}

export function readVerdict(output: string): boolean {
  const envelope = sandboxEnvelope(output);

  if (envelope) {
    // A non-zero exit is a failure whatever the text says.
    if (envelope.exitCode !== 0) return false;
    // A zero exit that nonetheless reports a failure is still a failure: a
    // script can print "FAIL" and forget to exit non-zero.
    return !FAILURE.test(envelope.text);
  }

  if (FAILURE.test(output) || /\berror\b/i.test(output)) return false;
  return SUCCESS.test(output);
}

/**
 * What a sandbox verification produced.
 *
 * The map shows this next to the gate, because an operator being asked to
 * approve an irreversible transfer should see the arithmetic that justified it
 * rather than a summary of it.
 */
export interface Verification {
  readonly script: string;
  readonly output: string;
  readonly passed: boolean;
}
