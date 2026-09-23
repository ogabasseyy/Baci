/**
 * Versioned claim-store layout. Version 1 was a bare JSON array of claim
 * strings; version 2 wraps the same entries in an envelope so upgrade
 * migrations are detectable on read.
 */
const CLAIM_STORE_VERSION = 2;

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
  // checkouts recorded the native purchase under the bare order id. Carry
  // those ids forward unchanged so the legacy ad-purchase dedupe survives
  // — and nothing else. In particular, never synthesize
  // `payment_completed:<id>` entries here: v1 acquired the bare claim at
  // order creation even for methods that settle later (bank transfer,
  // BNPL), so a synthesized completion claim would permanently suppress
  // the new canonical payment_completed for outstanding orders that
  // settle after the upgrade. Reopening a previously paid order stays
  // safe without it: the completion lane skips the ad purchase whenever
  // the bare purchase claim is held, so only the (never previously
  // emitted) funnel event goes out.
  //
  // This runs on the unversioned layout only. The first successful write
  // persists the versioned envelope, so later reads skip this branch;
  // until then the migration recomputes identically per read.
  return [...new Set(filterClaimEntries(parsed))];
}

export function serializeTrackedOrderIds(claims: string[]): string {
  return JSON.stringify({ version: CLAIM_STORE_VERSION, claims });
}
