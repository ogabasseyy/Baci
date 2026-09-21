/**
 * Versioned claim-store layout. Version 1 was a bare JSON array of claim
 * strings; version 2 wraps the same entries in an envelope so upgrade
 * migrations are detectable on read.
 */
const CLAIM_STORE_VERSION = 2;
const COMPLETION_EVENT_NAME = 'payment_completed';

function filterClaimEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
}

function isVersionedClaimStore(value: unknown): value is {
  version: unknown;
  claims: unknown;
} {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return 'version' in value && 'claims' in value;
}

export function parseTrackedOrderIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (isVersionedClaimStore(parsed)) {
    return parsed.version === CLAIM_STORE_VERSION
      ? filterClaimEntries(parsed.claims)
      : [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  // One-time upgrade migration for the version-1 layout: pre-namespacing
  // checkouts recorded the native purchase under the bare order id, while
  // completion now claims `payment_completed:<orderId>`. Carry each bare id
  // forward as a completion claim so reopening a previously paid order (or
  // reaching its settlement screen) cannot emit Order Completed plus the
  // ad-platform purchase a second time.
  //
  // This runs on the unversioned layout only — never by matching bare ids
  // at claim time — because current code also stores bare ids for
  // order_created, and those must not suppress new completions. The first
  // successful write persists the versioned envelope, so later reads skip
  // this branch; until then the migration recomputes identically per read.
  const legacy = filterClaimEntries(parsed);
  const migrated = new Set(legacy);
  for (const entry of legacy) {
    if (!entry.includes(':')) {
      migrated.add(`${COMPLETION_EVENT_NAME}:${entry}`);
    }
  }
  return [...migrated];
}

export function serializeTrackedOrderIds(claims: string[]): string {
  return JSON.stringify({ version: CLAIM_STORE_VERSION, claims });
}
