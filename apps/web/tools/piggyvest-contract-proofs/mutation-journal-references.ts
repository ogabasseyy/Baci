import { createHash, randomBytes } from 'node:crypto';
import type { Journal } from './mutation-journal';
import { HarnessRefusal } from './safety-guards';

/** Reference bookkeeping over the mutation journal (minting, reuse checks). */

/**
 * Order-sensitive fingerprint of the wallets an intent touches, hashed exactly
 * as sent ([source, destination], no sort), so a reversed transfer never
 * matches. It is an unsalted, truncated SHA-256 and is ONLY a consistency
 * check that a re-sent reference moves money between the same wallets, in the
 * same direction, as the original. It is not a
 * secret and does not hide the ids from anyone holding a candidate list, so the
 * local 0600 journal is the only protection. A keyed digest is deliberately not
 * used: the journal outlives a run, and a run-local key would make every
 * resumed run reject its own earlier entries.
 */
export function walletsDigest(walletIds: readonly string[]): string {
  return createHash('sha256')
    .update(JSON.stringify([...walletIds]))
    .digest('hex')
    .slice(0, 16);
}

/**
 * True only when this QA key already sent the reference for the same
 * operation, it was accepted, and the original intent, sent from the named
 * slot, moved the same amount between the same wallets in the same direction. A missing digest (older journal) never matches.
 */
export function acceptedReference(
  journal: Journal,
  reference: string,
  qaKey: string,
  op: string,
  expected: {
    amountKobo: number | null;
    walletIds: readonly string[];
    /** The slot the original send used. */
    slot: string;
  }
): boolean {
  const all = journal.entries();
  const digest = walletsDigest(expected.walletIds);
  return all.some(
    (intent) =>
      intent.phase === 'intent' &&
      intent.reference === reference &&
      intent.qaKey === qaKey &&
      intent.op === op &&
      intent.slot === expected.slot &&
      intent.amountKobo === expected.amountKobo &&
      intent.walletsDigest === digest &&
      all.some(
        (entry) =>
          entry.phase === 'outcome' &&
          entry.reference === reference &&
          entry.slot === intent.slot &&
          entry.outcome === 'accepted'
      )
  );
}

export function referenceInUse(journal: Journal, reference: string): boolean {
  return journal.entries().some((entry) => entry.reference === reference);
}

export function newReference(
  journal: Journal,
  op: string,
  runId: string,
  random: () => string = () => randomBytes(4).toString('hex')
): string {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const reference = `pvbproof-${runId}-${op}-${random()}`;
    if (!referenceInUse(journal, reference)) return reference;
  }
  throw new HarnessRefusal(
    'REFERENCE_REUSE',
    'could not mint a unique reference'
  );
}
