import { filterPushTokensByShipmentUpdateCapability } from '@/lib/push-token-capability';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { PushStore } from './push-store';

type AdminSupabase = ReturnType<typeof createAdminClient>;

/** Wraps a service-role client in the push store contract (existing queries, unchanged). */
export function createAdminPushStore(supabase: AdminSupabase): PushStore {
  return {
    fetchMerchantTokens: ({
      merchantId,
      recipientUserIds,
      requiredCapability,
    }) => {
      const adminTokenQuery = supabase
        .from('push_tokens')
        .select('token, platform')
        .eq('merchant_id', merchantId)
        .eq('is_active', true)
        .eq('app_type', 'admin');
      return filterPushTokensByShipmentUpdateCapability(
        recipientUserIds
          ? adminTokenQuery.in('user_id', recipientUserIds)
          : adminTokenQuery,
        requiredCapability
      ) as unknown as ReturnType<PushStore['fetchMerchantTokens']>;
    },
    fetchCustomerTokens: ({ userId, merchantId, requiredCapability }) => {
      let tokenQuery = supabase
        .from('push_tokens')
        .select('token, platform')
        .eq('user_id', userId)
        .eq('is_active', true)
        .eq('app_type', 'storefront');
      if (merchantId) {
        tokenQuery = tokenQuery.eq('merchant_id', merchantId);
      }
      return filterPushTokensByShipmentUpdateCapability(
        tokenQuery,
        requiredCapability
      ) as unknown as ReturnType<PushStore['fetchCustomerTokens']>;
    },
    deactivateTokens: (reason, tokens) =>
      supabase
        .from('push_tokens')
        .update({
          is_active: false,
          deactivation_reason: reason,
          deactivated_at: new Date().toISOString(),
        })
        .in('token', tokens),
    insertTickets: (rows) =>
      supabase.from('push_notification_tickets').insert(rows),
    insertAttempt: (row) =>
      supabase.from('push_notification_attempts').insert(row),
  };
}
