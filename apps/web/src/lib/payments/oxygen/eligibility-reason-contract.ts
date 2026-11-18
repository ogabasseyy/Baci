import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';

export const oxygenEligibilityReasonHeader = 'x-oxygen-eligibility-reason';

/** Older checkout bundles strictly validate snapshots and cannot accept new keys. */
export function oxygenSnapshotForClient(
  snapshot: OxygenRuntimeSnapshot,
  supportsReason: boolean,
  supportsProgress = false
): OxygenRuntimeSnapshot {
  if (supportsReason && supportsProgress) return snapshot;
  const state = { ...snapshot.state };
  if (!supportsReason) delete state.eligibilityFailureReason;
  if (!supportsProgress) delete state.eligibilityProgress;
  return { ...snapshot, state };
}
