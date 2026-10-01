import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdsCredentialServiceClient } from '@/lib/ads/server-credential-client';
import { syncMetaAdsSpendForMerchant } from './sync';

export function createMetaAdsSyncTestCall(rpc: SupabaseClient['rpc']) {
  return (dates?: { endDate: string; startDate: string }) =>
    syncMetaAdsSpendForMerchant({
      endDate: dates?.endDate ?? '2026-08-20',
      credentialSupabase: {
        rpc,
      } as unknown as AdsCredentialServiceClient,
      merchantId: 'merchant',
      spendSupabase: { rpc } as SupabaseClient,
      startDate: dates?.startDate ?? '2026-08-20',
      syncRunStartedAt: '2026-08-27T22:00:00.000Z',
      supabase: { rpc } as SupabaseClient,
    });
}
