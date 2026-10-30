import { supabase } from '@/lib/supabase';
import { trackEvent } from '@/services/analytics';
import { coerceDatabaseNumber } from './wallet-transaction-normalize';

export async function readWalletOwner(
  customerId: string | null,
  merchantId: string,
  userId: string | null
): Promise<{ customerId: string | null; loyaltyPoints: number }> {
  const empty = { customerId: null, loyaltyPoints: 0 };
  if (!customerId && !userId) return empty;
  let query = supabase
    .from('customers')
    .select('id, loyalty_points')
    .eq('merchant_id', merchantId);
  query = customerId ? query.eq('id', customerId) : query.eq('user_id', userId);
  const { data, error } = await query.limit(2);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  if (rows.length !== 1) {
    if (rows.length > 1) {
      console.warn(
        'Expected one customer wallet owner, received multiple rows',
        {
          customerId,
          merchantId,
          userId,
        }
      );
      trackEvent('multiple_customer_wallet_owner', {
        customerId,
        merchantId,
        numberOfRows: rows.length,
        severity: 'data_integrity',
        userId,
      });
    }
    return empty;
  }
  return {
    customerId:
      customerId ?? (typeof rows[0].id === 'string' ? rows[0].id : null),
    loyaltyPoints: coerceDatabaseNumber(rows[0].loyalty_points) ?? 0,
  };
}
