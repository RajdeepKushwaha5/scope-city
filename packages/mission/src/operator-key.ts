import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

/**
 * Who approved this, in a form a stranger can check.
 *
 * The mission record is hash-chained, so nobody can reorder its entries or edit
 * one without the head changing. That proves the log was not tampered with. It
 * does not prove a *human* authorised the refund, because `gate.cleared` said
 * only `approved: true` and `grantedBy` was a string the process wrote about
 * itself. A record that attests to its own honesty is exactly as trustworthy as
 * the process that wrote it, which is to say not independently at all.
 *
 * So the countersign is signed. The operator holds an Ed25519 key, the
 * signature covers the call fingerprint the approval was already bound to, and
 * `verify-record.mjs` checks it with the public half. An approval can now be
 * checked by someone who does not trust this code, which is the difference
 * between a log and evidence.
 *
 * **What this proves, exactly.** The holder of that private key approved that
 * exact call, under that exact scope version. Not that a particular person did:
 * a key sitting in a `.env` on the same machine proves the process holding it
 * approved, and a real operator identity needs OIDC or a hardware token. That
 * limit is worth stating plainly rather than letting a signature imply more
 * than it carries. What it does remove is the gap where the record was the only
 * witness to itself.
 *
 * Ed25519 rather than RSA or ECDSA: small keys, small signatures, no parameter
 * choices to get wrong, and it is in `node:crypto` already.
 */

/** A signed approval, as it travels into the record. */
export interface CountersignSignature {
  /** Base64 Ed25519 signature over the call fingerprint. */
  readonly signature: string;
  /** Short, stable id for the public key, so a reader can tell keys apart. */
  readonly operator: string;
  /** How the signature was produced, so a verifier is not guessing. */
  readonly algorithm: "ed25519";
}

/** Signs approvals, and can say which key it is. */
export interface OperatorSigner {
  readonly operator: string;
  readonly publicKeyPem: string;
  sign(fingerprint: string): CountersignSignature;
}

/**
 * A short, readable id for a public key.
 *
 * The full SPKI is unreadable at a glance and the point of printing it is that
 * a person can see two runs were approved by the same key, or notice that they
 * were not. Sixteen hex characters of the raw key, grouped, is enough to tell
 * apart and short enough to sit on one line of the verifier's output.
 */
export function operatorId(publicKey: KeyObject): string {
  const raw = publicKey.export({ format: "der", type: "spki" });
  // The last 32 bytes of an Ed25519 SPKI are the key itself.
  const key = raw.subarray(raw.length - 32);
  const hex = key.toString("hex");
  return `${hex.slice(0, 8)}…${hex.slice(-4)}`;
}

/**
 * The signer for this process, from an operator key or a fresh one.
 *
 * `SCOPE_OPERATOR_KEY` is a base64 PKCS8 Ed25519 private key. When it is
 * absent, a key is generated for this process and the caller is told, because a
 * signature from a key that dies with the process is a weaker claim and the
 * difference must not be silent. A fresh clone still gets signed records; it
 * just gets records signed by a key nobody has seen before, which is honest and
 * is what the verifier will report.
 */
export function operatorSigner(secret = process.env.SCOPE_OPERATOR_KEY ?? ""): {
  readonly signer: OperatorSigner;
  /** True when the key was generated here rather than configured. */
  readonly ephemeral: boolean;
} {
  let privateKey: KeyObject;
  let ephemeral = false;

  const trimmed = secret.trim();
  if (trimmed !== "") {
    privateKey = createPrivateKey({
      key: Buffer.from(trimmed, "base64"),
      format: "der",
      type: "pkcs8",
    });
  } else {
    privateKey = generateKeyPairSync("ed25519").privateKey;
    ephemeral = true;
  }

  const publicKey = createPublicKey(privateKey);
  const id = operatorId(publicKey);

  return {
    ephemeral,
    signer: {
      operator: id,
      publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
      sign(fingerprint: string): CountersignSignature {
        return {
          // Ed25519 signs the message directly: no digest argument, which is
          // why the first parameter is null.
          signature: sign(null, Buffer.from(fingerprint, "utf8"), privateKey).toString("base64"),
          operator: id,
          algorithm: "ed25519",
        };
      },
    },
  };
}

/**
 * Whether this signature really covers this fingerprint.
 *
 * Written to be usable by something that did not produce the record: it takes
 * the public key as PEM and touches nothing else, so the verifier can check an
 * approval without importing the code that made it.
 */
export function verifyCountersign(params: {
  readonly fingerprint: string;
  readonly signature: string;
  readonly publicKeyPem: string;
}): boolean {
  try {
    return verify(
      null,
      Buffer.from(params.fingerprint, "utf8"),
      createPublicKey(params.publicKeyPem),
      Buffer.from(params.signature, "base64"),
    );
  } catch {
    // A malformed key or signature is a failed verification, not a crash. The
    // verifier's job is to answer the question, and "no" is an answer.
    return false;
  }
}

/** A private key as `SCOPE_OPERATOR_KEY` wants it, for generating one. */
export function newOperatorKeyBase64(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}
