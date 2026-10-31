import { createHash } from 'node:crypto';

/**
 * Proof 7 creates a NEW QA customer per attempt. Its key is derived from a
 * hash of the FULL selected QA key (never a truncation), so two QA keys that
 * share a prefix get distinct customers and distinct journal scopes. The same
 * mapping is used to recognise a QA key's own derived keys in the journal.
 */

const digest = (qaKey: string): string =>
  createHash('sha256')
    .update(`piggyvest-proof7/v1:${qaKey}`)
    .digest('hex')
    .slice(0, 24);

export function proof7KeyPrefix(qaKey: string): string {
  return `p7-${digest(qaKey)}-a`;
}

/** At most 3 + 24 + 2 + 2 = 31 characters, well inside the 64-char journal key. */
export function proof7Key(qaKey: string, attempt: number): string {
  return `${proof7KeyPrefix(qaKey)}${attempt}`;
}

export function isProof7KeyOf(qaKey: string, candidate: string): boolean {
  const prefix = proof7KeyPrefix(qaKey);
  return (
    candidate.startsWith(prefix) &&
    /^\d{1,2}$/.test(candidate.slice(prefix.length))
  );
}
