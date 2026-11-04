import 'server-only';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import { oxygenEligibilityPrerequisites } from './eligibility-prerequisites';
import { readOxygenErrorReport } from './error-report';
import type { OxygenRuntimeRpc } from './runtime-service';

/** Called only after the customer's ownership-scoped status read succeeds. */
export async function restoreOxygenEligibilityRecovery(
  snapshot: OxygenRuntimeSnapshot,
  worker: () => Promise<OxygenRuntimeRpc>
): Promise<OxygenRuntimeSnapshot> {
  if (
    !snapshot.executionEnabled ||
    snapshot.pending ||
    snapshot.state.bookingReference ||
    snapshot.state.eligible !== undefined ||
    snapshot.state.eligibilityStatus === 'failed' ||
    !['eligibility_required', 'kyc_required'].includes(snapshot.stage) ||
    !oxygenEligibilityPrerequisites(snapshot.state)
  )
    return snapshot;
  const reports = await readOxygenErrorReport(
    await worker(),
    snapshot.workflowId
  );
  const failed = reports.some(
    (row) =>
      row.workflowId === snapshot.workflowId &&
      row.applicationReference === snapshot.state.applicationReference &&
      row.action === 'refresh_eligibility' &&
      row.status === 'failed' &&
      row.diagnostic.operation === 'eligibility'
  );
  return failed
    ? { ...snapshot, state: { ...snapshot.state, eligibilityStatus: 'failed' } }
    : snapshot;
}
