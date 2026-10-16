import { createHash } from 'node:crypto';

// Fixed RFC 4122 namespace for Baci server telemetry event ids. Changing it
// changes every derived uuid, breaking PostHog-side dedup across deploys.
const TELEMETRY_UUID_NAMESPACE = 'e3f1a6d2-8c47-4b09-9d15-2f6b71c0a884';

function uuidToBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll('-', ''), 'hex');
}

/**
 * RFC 4122 v5 (SHA-1, name-based) UUID over a fixed telemetry namespace.
 * The same `name` always yields the same uuid, so two concurrent emitters of
 * one logical event (e.g. webhook + confirm route both crediting the same
 * ledger transaction) produce identical event ids and PostHog ingestion
 * deduplicates them into a single event.
 */
export function deterministicEventUuid(name: string): string {
  // SAFE (SAST-reviewed): RFC 4122 v5 UUIDs are SHA-1 by definition — the
  // version-5 nibble set below is only meaningful over SHA-1. Upgrading the
  // hash would break the UUID format and PostHog dedup compat. Use is
  // telemetry event-id derivation only, never integrity or auth.
  // nosemgrep: javascript.node-stdlib.cryptography.crypto-weak-algorithm.crypto-weak-algorithm
  const hash = createHash('sha1')
    .update(uuidToBytes(TELEMETRY_UUID_NAMESPACE))
    .update(Buffer.from(name, 'utf8'))
    .digest();

  const bytes = hash.subarray(0, 16);
  // biome-ignore lint/style/noNonNullAssertion: sha1 digests are 20 bytes, indexes 6/8 exist
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; // version 5
  // biome-ignore lint/style/noNonNullAssertion: sha1 digests are 20 bytes, indexes 6/8 exist
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
