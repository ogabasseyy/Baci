import 'server-only';
import type { OxygenRuntimeSnapshot } from '@/schemas/oxygen-runtime-view';
import type { OxygenRuntimeRpc } from './runtime-service';

/** No diagnostics are returned; admission rechecks the proof under its lock. */
export async function readOxygenNinRetryStatus(
  client: OxygenRuntimeRpc,
  snapshot: OxygenRuntimeSnapshot
): Promise<'first_attempt' | 'safe_retry' | 'blocked' | 'unavailable'> {
  if (snapshot.pending || snapshot.state.kyc?.nin_status !== 'NOT_DONE')
    return 'blocked';
  try {
    const { data, error } = await client.rpc('oxygen_nin_attempt_status', {
      p_workflow_id: snapshot.workflowId,
      p_version: snapshot.version,
    });
    return !error &&
      (data === 'first_attempt' || data === 'safe_retry' || data === 'blocked')
      ? data
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
