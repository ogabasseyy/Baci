import type { CartPreviousSessionSecret } from './cart-runtime-env';

const MIN_SECRET_LENGTH = 32;

/**
 * Maximum time a retired secret keeps verifying proofs after its
 * retirement instant. Deliberately far shorter than a proof lifetime:
 * rotation is an operator action that forces re-bootstrap within a
 * day, in exchange for closing the backdated-issuance forgery window
 * (see below) quickly. A compromised retired secret additionally
 * requires revoking the affected cart grants in the database, which
 * the SQL mutation paths recheck on every command.
 */
export const RETIRED_SECRET_GRACE_SECONDS = 24 * 60 * 60;

/**
 * Signing-key candidates for proof verification: the current key
 * first, then each retired key that could still have issued this
 * proof. A retired key only authenticates proofs issued no later
 * than its retirement, and only until one maximum proof lifetime
 * past that retirement has elapsed; after that no proof it signed
 * verifies, however it is dated.
 *
 * Accepted rotation trade-off: the issuance timestamp is read from
 * the proof before its signature is verified, so a compromised
 * retired secret can mint new proofs with a backdated issuance and
 * they verify until the grace window above closes. Rotation retires
 * issuance immediately at every issuer, forces re-bootstrap within
 * that window, and operators treat a leaked retired secret as live
 * (requiring grant revocation) until the window closes.
 */
export function verificationSecretCandidates(input: {
  currentSecret: string;
  previousSecrets: readonly CartPreviousSessionSecret[];
  sessionProofTtlSeconds: number;
  issuedAt: number;
  verifyNow: number;
}): string[] {
  const previous = input.previousSecrets.filter((entry) => {
    const retireAt = Math.floor(Date.parse(entry.retireAt) / 1000);
    return (
      Number.isFinite(retireAt) &&
      entry.secret.trim().length >= MIN_SECRET_LENGTH &&
      input.issuedAt <= retireAt &&
      input.verifyNow <=
        retireAt +
          Math.min(input.sessionProofTtlSeconds, RETIRED_SECRET_GRACE_SECONDS)
    );
  });
  return [input.currentSecret, ...previous.map((entry) => entry.secret)].filter(
    (candidate) => candidate.trim().length >= MIN_SECRET_LENGTH
  );
}
