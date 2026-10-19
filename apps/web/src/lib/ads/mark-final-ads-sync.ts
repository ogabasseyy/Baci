import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

export async function markAdsSyncStarted(input: {
  merchantId: string;
  provider: string;
  providerCustomerId: string;
  syncRunId: string;
  syncRunStartedAt: string;
  syncWindowEndDate: string;
  syncWindowStartDate: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  const result = await input.supabase.rpc(
    'mark_merchant_ads_connection_sync_started_if_current',
    {
      p_merchant_id: input.merchantId,
      p_provider: input.provider,
      p_provider_customer_id: input.providerCustomerId,
      p_sync_run_id: input.syncRunId,
      p_sync_run_started_at: input.syncRunStartedAt,
      p_sync_window_end_date: input.syncWindowEndDate,
      p_sync_window_start_date: input.syncWindowStartDate,
    }
  );
  return !result.error && result.data === true;
}

export async function markFinalAdsSync(input: {
  finalChunk?: boolean;
  merchantId: string;
  provider: string;
  providerCustomerId: string;
  syncRunId: string;
  syncWindowEndDate: string;
  syncWindowStartDate: string;
  supabase: SupabaseClient;
}): Promise<boolean> {
  if (input.finalChunk === false) return true;
  const result = await input.supabase.rpc(
    'mark_merchant_ads_connection_synced_if_current',
    {
      p_merchant_id: input.merchantId,
      p_provider: input.provider,
      p_provider_customer_id: input.providerCustomerId,
      p_sync_run_id: input.syncRunId,
      p_sync_window_end_date: input.syncWindowEndDate,
      p_sync_window_start_date: input.syncWindowStartDate,
    }
  );
  return !result.error && result.data === true;
}
