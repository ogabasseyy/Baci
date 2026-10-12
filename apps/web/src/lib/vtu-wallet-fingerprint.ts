import { createHash } from 'node:crypto';
import {
  canonicalizeVtuRetryIdentity,
  VTU_RETRY_IDENTITY_FIELDS,
} from '@baci/shared';
import type { VtuWalletOnlyChargeInput } from '@/schemas/vtu-wallet-only';

/**
 * Canonical fingerprint of the wallet-only request payload. Used by
 * the wallet-only route to detect a key being reused with a CHANGED
 * payload (e.g. the user edited the form between a timed-out attempt
 * and the retry). Field set comes from the shared retry-identity
 * module (same list both clients sign — see its doc for the
 * lockstep rationale and exclusion notes).
 *
 * The order of keys in the canonical object is fixed via an explicit
 * replacer array so the hash is stable across Node versions and
 * unrelated to property insertion order.
 */
export function computeVtuWalletRequestFingerprint(
  parsed: VtuWalletOnlyChargeInput
): string {
  const canonical = canonicalizeVtuRetryIdentity(
    parsed as unknown as Record<string, unknown>
  );
  return createHash('sha256')
    .update(JSON.stringify(canonical, [...VTU_RETRY_IDENTITY_FIELDS]))
    .digest('hex');
}
