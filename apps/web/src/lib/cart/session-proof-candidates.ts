import type { CartPreviousSessionSecret } from './cart-runtime-env';

const MIN_SECRET_LENGTH = 32;

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
 * they verify until one maximum proof lifetime after retirement —
 * in effect the retired key remains fully powerful for up to that
 * window. Rotation therefore retires issuance immediately at every
 * issuer, and operators treat a leaked retired secret as live until
 * the window closes.
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
      input.verifyNow <= retireAt + input.sessionProofTtlSeconds
    );
  });
  return [input.currentSecret, ...previous.map((entry) => entry.secret)].filter(
    (candidate) => candidate.trim().length >= MIN_SECRET_LENGTH
  );
}
