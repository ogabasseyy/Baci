import type { CartPreviousSessionSecret } from './cart-runtime-env';

const MIN_SECRET_LENGTH = 32;

/**
 * Signing-key candidates for proof verification: the current key
 * first, then each retired key that could still have issued this
 * proof. A retired key only authenticates proofs issued no later
 * than its retirement, and only until one maximum proof lifetime
 * past that retirement has elapsed; after that no proof it signed
 * verifies, however it is dated.
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
