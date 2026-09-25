import type { SupabaseClient } from '@supabase/supabase-js';
import { releaseJumiaSelfAuthorizationDiscovery } from '@/lib/jumia/self-authorization-discovery-store';
import { logger } from '@/lib/logger';

export async function releaseJumiaDiscoveryClaim(args: {
  claimToken: string;
  discoveryId: string;
  merchantId: string;
  supabase: SupabaseClient;
}): Promise<void> {
  try {
    await releaseJumiaSelfAuthorizationDiscovery(args.supabase, args);
  } catch (error) {
    logger.warn({
      message: 'Failed to release Jumia discovery claim',
      error,
      discovery_id: args.discoveryId,
      merchant_id: args.merchantId,
    });
  }
}
