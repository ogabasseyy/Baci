import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { selfieLinkExpired } from './selfie-link-expired';

/** A fresh saved status must prove the previous attempt is no longer pending. */
export function mayRetryFailedSelfie(
  previous: OxygenRuntimeSnapshot,
  current: OxygenRuntimeSnapshot | null
): boolean {
  return Boolean(
    current &&
      current.workflowId === previous.workflowId &&
      current.version > previous.version &&
      current.executionEnabled &&
      !current.pending &&
      ['eligibility_required', 'kyc_required'].includes(current.stage) &&
      current.state.validated &&
      current.state.applicationReference &&
      !current.state.bookingReference &&
      current.state.kyc?.selfie_status === 'NOT_DONE' &&
      (!current.state.selfieUrl || selfieLinkExpired(current.state.selfieUrl))
  );
}
