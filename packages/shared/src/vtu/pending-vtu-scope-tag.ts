import { hashVtuScopeDescriptor } from './vtu-scope-hash';

/**
 * Owner+merchant scope tag for a pending VTU entry. Mirrors the
 * `merchant:owner` prefix of the scoped-key preimage WITHOUT the
 * descriptor, so settle passes can filter retained references to
 * the active account without reversing the one-way scope digest
 * (Codex R62 6rtokd). Hashed like the scoped key: no new plaintext
 * identifiers at rest.
 *
 * Split from vtu-scope-hash.ts per the one-export rule (Codex R129
 * P1).
 */
export function buildPendingVtuScopeTag(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined
): string {
  return hashVtuScopeDescriptor(`${merchantId ?? ''}:${ownerId ?? ''}`);
}
