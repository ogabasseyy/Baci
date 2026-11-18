import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export const oxygenEligibilityReasonHeader = 'x-oxygen-eligibility-reason';

/** Older checkout bundles strictly validate snapshots and cannot accept new keys. */
export function oxygenSnapshotForClient(
  snapshot: OxygenRuntimeSnapshot,
  supportsReason: boolean
): OxygenRuntimeSnapshot {
  if (supportsReason) return snapshot;
  const state = { ...snapshot.state };
  delete state.eligibilityFailureReason;
  return { ...snapshot, state };
}
