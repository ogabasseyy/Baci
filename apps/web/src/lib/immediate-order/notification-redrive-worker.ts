import 'server-only';

import {
  immediateNotificationRecoveryBatchSize,
  immediateNotificationRecoveryCandidates,
} from '@/schemas/immediate-notification-redrive';

interface RecoveryClient {
  rpc(
    name: string,
    args: Record<string, unknown>
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

/** Records confirmed completions only; this worker has no email transport. */
export async function recoverImmediateNotifications(
  client: RecoveryClient,
  requestedLimit: number
) {
  const limit = immediateNotificationRecoveryBatchSize.parse(requestedLimit);
  const result = await client.rpc(
    'list_immediate_notification_recovery_candidates',
    { p_limit: limit }
  );
  if (result.error)
    throw new Error('Immediate notification recovery listing failed');
  const rows = immediateNotificationRecoveryCandidates.parse(result.data);
  if (rows.length > limit)
    throw new Error('Immediate notification recovery list exceeded its limit');
  let recovered = 0;
  let unresolved = 0;
  for (const row of rows) {
    if (row.status !== 'accepted') {
      unresolved += 1;
      continue;
    }
    const completion = await client.rpc(
      'recover_immediate_notification_completion',
      {
        p_order_id: row.order_id,
        p_claim_token: row.claim_token,
      }
    );
    if (completion.error)
      throw new Error('Immediate notification recovery failed');
    if (completion.data === true) recovered += 1;
    else unresolved += 1;
  }
  const backlog = await client.rpc(
    'has_immediate_notification_reconciliation_backlog',
    {}
  );
  if (backlog.error || typeof backlog.data !== 'boolean')
    throw new Error('Immediate notification backlog check failed');
  return { recovered, unresolved, hasReconciliationBacklog: backlog.data };
}
