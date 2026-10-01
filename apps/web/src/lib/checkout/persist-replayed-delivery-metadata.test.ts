import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { persistReplayedDeliveryMetadata } from './persist-replayed-delivery-metadata';

function createRpcClient(result: { data?: unknown; error: unknown }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return {
    client: {
      rpc,
    } as unknown as SupabaseClient,
    rpc,
  };
}

describe('persistReplayedDeliveryMetadata', () => {
  it('backfills canonical metadata when a legacy replay row is missing it', async () => {
    const { client, rpc } = createRpcClient({ data: true, error: null });

    const result = await persistReplayedDeliveryMetadata({
      airportType: 'pickup',
      deliveryMethod: 'airport',
      orderId: 'order-id',
      rpcClient: client,
    });

    expect(result).toEqual({ attempted: true, error: null });
    expect(rpc).toHaveBeenCalledWith(
      'persist_storefront_order_delivery_metadata',
      {
        p_airport_type: 'pickup',
        p_delivery_method: 'airport',
        p_order_id: 'order-id',
      }
    );
  });

  it('does not claim a replay when the scoped RPC reports no durable airport evidence', async () => {
    const { client, rpc } = createRpcClient({ data: false, error: null });

    const result = await persistReplayedDeliveryMetadata({
      airportType: 'delivery',
      deliveryMethod: 'airport',
      orderId: 'order-id',
      rpcClient: client,
    });

    expect(result).toEqual({ attempted: false, error: null });
    expect(rpc).toHaveBeenCalled();
  });

  it('does not overwrite metadata already persisted on a replay row', async () => {
    const { client, rpc } = createRpcClient({ data: false, error: null });

    const result = await persistReplayedDeliveryMetadata({
      airportType: 'delivery',
      deliveryMethod: 'airport',
      orderId: 'order-id',
      rpcClient: client,
    });

    expect(result).toEqual({ attempted: false, error: null });
    expect(rpc).toHaveBeenCalled();
  });

  it('fills only the missing metadata field on a partially persisted replay row', async () => {
    const { client, rpc } = createRpcClient({ data: true, error: null });

    const result = await persistReplayedDeliveryMetadata({
      airportType: 'pickup',
      deliveryMethod: 'airport',
      orderId: 'order-id',
      rpcClient: client,
    });

    expect(result).toEqual({ attempted: true, error: null });
    expect(rpc).toHaveBeenCalledWith(
      'persist_storefront_order_delivery_metadata',
      expect.objectContaining({
        p_airport_type: 'pickup',
        p_delivery_method: 'airport',
      })
    );
  });

  it('returns the persistence error so the route can fail closed for a retry', async () => {
    const persistenceError = { code: 'PGRST001', message: 'temporary outage' };
    const { client } = createRpcClient({ error: persistenceError });

    await expect(
      persistReplayedDeliveryMetadata({
        airportType: 'delivery',
        deliveryMethod: 'airport',
        orderId: 'order-id',
        rpcClient: client,
      })
    ).resolves.toEqual({ attempted: true, error: persistenceError });
  });
});
