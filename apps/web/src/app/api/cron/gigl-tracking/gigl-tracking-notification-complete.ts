import type { GiglNotificationRpcClient } from '@/lib/gigl-notification-worker-client';

export async function completeGiglTrackingNotification(
  supabase: GiglNotificationRpcClient,
  id: string,
  workerId: string,
  outcome: 'sent' | 'skipped' | 'failed' | 'rejected',
  error?: string
): Promise<boolean> {
  const { data, error: rpcError } = await supabase.rpc(
    'gigl_worker_complete_notification',
    {
      ...(error ? { p_error: error } : {}),
      p_id: id,
      p_outcome: outcome,
      p_worker_id: workerId,
    }
  );
  if (rpcError) throw rpcError;
  return data === true;
}
