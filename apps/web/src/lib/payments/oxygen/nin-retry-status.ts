import 'server-only';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import type { OxygenRuntimeRpc } from './runtime-service';

/** The database returns only a boolean and rechecks the proof under its lock. */
export async function readOxygenNinRetryStatus(
  client: OxygenRuntimeRpc,
  snapshot: OxygenRuntimeSnapshot
): Promise<boolean | null> {
  if (snapshot.pending || snapshot.state.kyc?.nin_status !== 'NOT_DONE')
    return false;
  try {
    const { data, error } = await client.rpc('oxygen_nin_retry_status', {
      p_workflow_id: snapshot.workflowId,
      p_version: snapshot.version,
    });
    return error || typeof data !== 'boolean' ? null : data;
  } catch {
    return null;
  }
}
