import type { SupabaseClient } from '@supabase/supabase-js';
import { getJumiaOrderScope } from '../../get-jumia-order-scope';

type CachedJumiaOrderItemsResult =
  | {
      kind: 'ok';
      orderId: string;
      orderNumber: string;
      items: unknown[];
    }
  | { kind: 'missing' }
  | { kind: 'database_error'; message: string };

/**
 * Reads order items already captured by the order sync without touching the
 * provider. View-only staff use this path because credential rotation is a
 * manage-authorized operation.
 */
export async function getCachedJumiaOrderItems(args: {
  supabase: SupabaseClient;
  merchantId: string;
  integrationId: string;
  orderId: string;
}): Promise<CachedJumiaOrderItemsResult> {
  const scope = await getJumiaOrderScope(
    args.supabase,
    args.merchantId,
    args.integrationId
  );
  if (scope.kind === 'database_error') return scope;
  if (scope.kind !== 'ok') return { kind: 'missing' };

  const { data, error } = await args.supabase
    .from('jumia_orders')
    .select('jumia_order_id, jumia_order_number, items')
    .eq('merchant_id', args.merchantId)
    .eq('jumia_order_id', args.orderId)
    .eq('jumia_shop_id', scope.shopId)
    .in('marketplace_key', scope.cachedMarketplaceKeys)
    .maybeSingle();

  if (error) return { kind: 'database_error', message: error.message };
  const row = data as {
    jumia_order_id: string;
    jumia_order_number: string | null;
    items: unknown;
  } | null;
  if (!row || !Array.isArray(row.items)) return { kind: 'missing' };

  return {
    kind: 'ok',
    orderId: row.jumia_order_id,
    orderNumber: row.jumia_order_number ?? '',
    items: row.items,
  };
}
