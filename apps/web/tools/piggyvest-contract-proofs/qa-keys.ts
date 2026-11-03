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

const digest10 = (qaKey: string): string =>
  createHash('sha256')
    .update(`piggyvest-proof10/v1:${qaKey}`)
    .digest('hex')
    .slice(0, 24);

export function proof10KeyPrefix(qaKey: string): string {
  return `p10-${digest10(qaKey)}-a`;
}

/**
 * Proof 10 (S8) measures money, so it gets its OWN QA customer, main wallet
 * and goal wallet per attempt: nothing proofs 1 to 9 do can land on them.
 */
export function proof10Key(qaKey: string, attempt: number): string {
  return `${proof10KeyPrefix(qaKey)}${attempt}`;
}

export function isProof10KeyOf(qaKey: string, candidate: string): boolean {
  const prefix = proof10KeyPrefix(qaKey);
  return (
    candidate.startsWith(prefix) &&
    /^\d{1,2}$/.test(candidate.slice(prefix.length))
  );
}

/** Any key derived from a QA key for a proof that runs on its own customer. */
export function isDerivedKeyOf(qaKey: string, candidate: string): boolean {
  return isProof7KeyOf(qaKey, candidate) || isProof10KeyOf(qaKey, candidate);
}
