import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * One-way digest for client-side pending-VTU scope keys.
 *
 * Both idempotency registries (web localStorage, mobile MMKV) key
 * entries by `merchant:owner:<canonical-descriptor>` strings whose
 * descriptor JSON embeds recipient phone / meter identifiers. The
 * snapshot only needs the mapping to be deterministic (same purchase
 * → same key across reloads), never reversible, so scope keys are
 * SHA-256 digests at rest: identifiers no longer sit in plaintext in
 * storage backups, forensic dumps, or crash-log captures.
 *
 * Sync noble hashes (audited, zero-dep) rather than WebCrypto: the
 * scope choke points are synchronous and mobile's Hermes lacks
 * subtle.digest. Deterministic and unsalted — salting is theater
 * here (any on-disk salt is as readable as the snapshot) and would
 * break cross-tab recall, which re-derives the key from the payload.
 * Residual honesty: the digest is verifiable by anyone who can guess
 * the payload (same-profile devtools), and shared-device clearing
 * still belongs to the app-wide sign-out epic — hashing removes
 * at-rest PII, not access control.
 */
export function hashVtuScopeDescriptor(scoped: string): string {
  return bytesToHex(sha256(utf8ToBytes(scoped)));
}

const VTU_SCOPE_HASH_PATTERN = /^[0-9a-f]{64}$/;

/** True for a digest produced by {@link hashVtuScopeDescriptor}. */
export function isVtuScopeHash(value: string): boolean {
  return VTU_SCOPE_HASH_PATTERN.test(value);
}

/**
 * True for a raw scope key the migration must hash: colon-bearing
 * (both scope separators and the descriptor JSON's own — even empty
 * merchant/owner still emit the separators) and not already a
 * digest. Bare colon-less keys are unproducible by either scope
 * choke point (only test fixtures) and pass through.
 */
export function isLegacyVtuScopeKey(scoped: string): boolean {
  return !isVtuScopeHash(scoped) && scoped.includes(':');
}

/**
 * Migrates a persisted scope key to its digest form (migrate-on-read).
 *
 * Legacy snapshots hold raw `merchant:owner:<json>` keys, which always
 * contain colons (both scope separators and the descriptor JSON's own
 * — even empty merchant/owner still emit the separators); digests
 * never do. So: digests pass through, colon-bearing keys hash, and
 * bare colon-less keys (unproducible by either scope choke point —
 * only test fixtures) pass through untouched. Deterministic, so
 * re-parsing an already-migrated snapshot is a no-op and entries
 * still match their tombstones after both sides migrate.
 *
 * INVARIANT: if a scope format ever stops emitting colons, this
 * detector must change with it or raw keys will persist unhashed.
 */
export function normalizePersistedVtuScopeKey(scoped: string): string {
  if (!isLegacyVtuScopeKey(scoped)) {
    return scoped;
  }
  return hashVtuScopeDescriptor(scoped);
}

/**
 * Owner+merchant scope tag for a pending VTU entry. Mirrors the
 * `merchant:owner` prefix of the scoped-key preimage WITHOUT the
 * descriptor, so settle passes can filter retained references to
 * the active account without reversing the one-way scope digest
 * (Codex R62 6rtokd). Hashed like the scoped key: no new plaintext
 * identifiers at rest.
 */
export function buildPendingVtuScopeTag(
  ownerId: string | null | undefined,
  merchantId: string | null | undefined
): string {
  return hashVtuScopeDescriptor(`${merchantId ?? ''}:${ownerId ?? ''}`);
}
