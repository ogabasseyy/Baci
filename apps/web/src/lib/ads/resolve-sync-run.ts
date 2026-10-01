import type { SupabaseClient } from '@supabase/supabase-js';

export type AdsSyncRun = {
  syncRunId: string;
  syncRunStartedAt: string;
};

/**
 * Resolve the server-owned ordering identity for an Ads refresh.
 *
 * A request without a run ID starts a new run and gets both values from the
 * server. Continuation requests must refer to the run currently registered on
 * the connection; their caller-supplied timestamp is deliberately ignored.
 */
export async function resolveAdsSyncRun(input: {
  merchantId: string;
  provider: string;
  requestedSyncRunId?: string;
  supabase: SupabaseClient;
}): Promise<AdsSyncRun | null> {
  if (!input.requestedSyncRunId) {
    return {
      syncRunId: crypto.randomUUID(),
      syncRunStartedAt: new Date().toISOString(),
    };
  }

  const { data, error } = await input.supabase.rpc(
    'get_merchant_ads_sync_run_started_at',
    {
      p_merchant_id: input.merchantId,
      p_provider: input.provider,
      p_sync_run_id: input.requestedSyncRunId,
    }
  );
  if (error || typeof data !== 'string' || data.length === 0) return null;

  return {
    syncRunId: input.requestedSyncRunId,
    syncRunStartedAt: data,
  };
}
