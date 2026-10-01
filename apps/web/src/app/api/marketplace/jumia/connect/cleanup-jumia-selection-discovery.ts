import type { SupabaseClient } from '@supabase/supabase-js';
import {
  consumeJumiaSelfAuthorizationDiscovery,
  releaseJumiaSelfAuthorizationDiscovery,
} from '@/lib/jumia/self-authorization-discovery-store';
import { logger } from '@/lib/logger';

export async function cleanupJumiaSelectionDiscovery(args: {
  supabase: SupabaseClient;
  discoveryId: string;
  merchantId: string;
  clientKeyHash: string;
  claimToken: string;
  discoveryComplete: boolean;
}): Promise<void> {
  try {
    if (args.discoveryComplete) {
      await consumeJumiaSelfAuthorizationDiscovery(args.supabase, {
        discoveryId: args.discoveryId,
        merchantId: args.merchantId,
        clientKeyHash: args.clientKeyHash,
        claimToken: args.claimToken,
      });
    } else {
      await releaseJumiaSelfAuthorizationDiscovery(args.supabase, {
        discoveryId: args.discoveryId,
        merchantId: args.merchantId,
        claimToken: args.claimToken,
      });
    }
  } catch (error) {
    logger.warn({
      message:
        'Jumia self-authorization connect succeeded but discovery cleanup failed',
      error,
      discovery_id: args.discoveryId,
      merchant_id: args.merchantId,
    });
  }
}
