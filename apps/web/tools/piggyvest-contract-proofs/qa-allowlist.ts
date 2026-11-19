import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';
import { resolvePiggyvestStagingSyntheticIdentity } from '@/lib/piggyvest/staging-synthetic-identity';
import { assertNoRecordingAccount, HarnessRefusal } from './safety-guards';

/**
 * The allowlist names the QA customers the harness may touch. Each entry is
 * an opaque QA key chosen by the operator; the synthetic identity and the
 * third_party_identifier are derived from it deterministically. Provider
 * customers are only ever created or mutated for these keys.
 */

const MAX_ALLOWLIST_BYTES = 16 * 1024;

const qaCustomerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/);

const allowlistSchema = z
  .strictObject({
    qaCustomerIds: z.array(qaCustomerIdSchema).min(1).max(20),
  })
  .refine(
    (value) => new Set(value.qaCustomerIds).size === value.qaCustomerIds.length
  );

export type QaAllowlist = z.infer<typeof allowlistSchema>;

export function parseAllowlist(text: string): QaAllowlist {
  // Scan the raw text first: even a stray note must not mention the account.
  assertNoRecordingAccount('allowlist file', text);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new HarnessRefusal(
      'ALLOWLIST_INVALID',
      'allowlist is not valid JSON'
    );
  }
  const parsed = allowlistSchema.safeParse(json);
  if (!parsed.success) {
    throw new HarnessRefusal(
      'ALLOWLIST_INVALID',
      'allowlist must be {"qaCustomerIds": [8-64 char ids]} with no duplicates'
    );
  }
  assertDistinctSyntheticIdentities(parsed.data.qaCustomerIds);
  return parsed.data;
}

/**
 * The provider matches an existing customer on BVN or email, so two keys that
 * derive the same synthetic BVN or email would be handed each other's customer.
 * The BVN is only 8 hashed digits, so this can happen; refuse such a list.
 * (The setup also verifies every existing customer it is handed.)
 */
function assertDistinctSyntheticIdentities(keys: readonly string[]): void {
  const seen = new Set<string>();
  for (const key of keys) {
    const { bvn, email } = resolvePiggyvestStagingSyntheticIdentity(key);
    for (const fingerprint of [`bvn:${bvn}`, `email:${email.toLowerCase()}`]) {
      if (seen.has(fingerprint)) {
        throw new HarnessRefusal(
          'ALLOWLIST_INVALID',
          'two allowlisted QA keys derive the same synthetic BVN or email; remove one of them'
        );
      }
      seen.add(fingerprint);
    }
  }
}

export function loadAllowlist(filePath: string): QaAllowlist {
  let text: string;
  try {
    const stats = statSync(filePath);
    if (!stats.isFile() || stats.size > MAX_ALLOWLIST_BYTES) {
      throw new Error('unusable');
    }
    text = readFileSync(filePath, 'utf8');
  } catch {
    throw new HarnessRefusal(
      'ALLOWLIST_INVALID',
      'allowlist file is missing, unreadable or too large'
    );
  }
  return parseAllowlist(text);
}
