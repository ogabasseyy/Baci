import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrderCreateInput } from '@/schemas/orders';

type PersistReplayedDeliveryMetadataInput = {
  airportType: OrderCreateInput['airport_type'];
  deliveryMethod: OrderCreateInput['delivery_method'];
  orderId: string;
  rpcClient: SupabaseClient;
};

type PersistReplayedDeliveryMetadataResult = {
  attempted: boolean;
  error: unknown | null;
};

/**
 * Backfill delivery metadata on a legacy idempotency replay when the original
 * order predates the metadata columns or the rollout-time persistence path.
 * Existing non-null metadata is never overwritten.
 */
export async function persistReplayedDeliveryMetadata({
  airportType,
  deliveryMethod,
  orderId,
  rpcClient,
}: PersistReplayedDeliveryMetadataInput): Promise<PersistReplayedDeliveryMetadataResult> {
  if (!deliveryMethod && !airportType) {
    return { attempted: false, error: null };
  }

  const { data, error } = await rpcClient.rpc(
    'persist_storefront_order_delivery_metadata',
    {
      p_airport_type: airportType ?? null,
      p_delivery_method: deliveryMethod ?? null,
      p_order_id: orderId,
    }
  );

  return { attempted: error !== null || data === true, error };
}
