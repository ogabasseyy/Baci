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
