import { v5 as uuidv5 } from 'uuid';

// Fixed RFC 4122 namespace for Baci server telemetry event ids. Changing it
// changes every derived uuid, breaking PostHog-side dedup across deploys.
const TELEMETRY_UUID_NAMESPACE = 'e3f1a6d2-8c47-4b09-9d15-2f6b71c0a884';

/**
 * RFC 4122 v5 (SHA-1, name-based) UUID over a fixed telemetry namespace.
 * The same `name` always yields the same uuid, so two concurrent emitters of
 * one logical event (e.g. webhook + confirm route both crediting the same
 * ledger transaction) produce identical event ids and PostHog ingestion
 * deduplicates them into a single event.
 */
export function deterministicEventUuid(name: string): string {
  return uuidv5(name, TELEMETRY_UUID_NAMESPACE);
}
