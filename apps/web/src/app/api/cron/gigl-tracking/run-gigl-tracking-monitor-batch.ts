import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import {
  claimedGiglTrackingMonitorsSchema,
  processClaimedGiglTrackingMonitors,
} from './gigl-tracking-monitor-worker';

type ProcessMonitors = typeof processClaimedGiglTrackingMonitors;

export async function runGiglTrackingMonitorBatch({
  batchSize,
  client,
  processMonitors = processClaimedGiglTrackingMonitors,
  workerId,
}: {
  batchSize: number;
  client: Pick<SupabaseClient<Database>, 'rpc'>;
  processMonitors?: ProcessMonitors;
  workerId: string;
}) {
  const { data, error } = await client.rpc('claim_due_gigl_tracking_monitors', {
    p_limit: batchSize,
    p_worker_id: workerId,
  });
  if (error) return { ok: false as const, reason: 'claim_failed' as const };

  const monitors = claimedGiglTrackingMonitorsSchema.safeParse(data ?? []);
  if (!monitors.success) {
    return { ok: false as const, reason: 'invalid_claim_payload' as const };
  }

  try {
    return {
      ok: true as const,
      summary: await processMonitors(client, monitors.data, workerId),
    };
  } catch {
    return { ok: false as const, reason: 'worker_failed' as const };
  }
}
