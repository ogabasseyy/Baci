import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logger';

export type PurgeOrphanedJumiaAuthorizationResult =
  | 'purged'
  | 'reactivated'
  | 'not_found'
  | 'failed';

export async function purgeOrphanedJumiaAuthorization(
  supabase: SupabaseClient,
  merchantId: string,
  integrationId: string
): Promise<PurgeOrphanedJumiaAuthorizationResult> {
  const { data, error } = await supabase.rpc(
    'purge_orphaned_jumia_authorization',
    {
      p_merchant_id: merchantId,
      p_integration_id: integrationId,
    }
  );
  if (error) {
    logger.error({
      message: 'Failed to purge orphaned Jumia authorization',
      error,
    });
    return 'failed';
  }
  if (data === 'reactivated' || data === 'not_found' || data === 'purged') {
    return data;
  }
  logger.error({
    message: 'Unexpected Jumia purge RPC status',
    status: data,
  });
  return 'failed';
}
