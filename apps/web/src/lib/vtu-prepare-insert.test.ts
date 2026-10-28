import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  insertPreparedVtuTransactionDirect,
  insertPreparedVtuTransactionViaRpc,
  type VtuTransactionInsertPayload,
} from './vtu-prepare-insert';

const INSERTED = {
  amount: 500,
  customer_identifier: '08012345678',
  id: 'tx-1',
  metadata: { walletDebited: false },
  request_reference: 'req-1',
  status: 'pending',
  type: 'airtime',
};

const PAYLOAD = {
  amount: 500,
  customer_identifier: '08012345678',
  customer_id: 'customer-1',
  merchant_id: 'merchant-1',
  metadata: { walletDebited: false },
  network_provider: 'mtn',
  order_id: 'order-1',
  phone_number: '08012345678',
  request_reference: 'req-1',
  source: 'checkout',
  type: 'airtime',
} as VtuTransactionInsertPayload & { customer_id: string };

function buildDirectClient(result: {
  data: typeof INSERTED | null;
  error: { message: string } | null;
}) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  return {
    client: { from } as unknown as SupabaseClient,
    from,
    insert,
    select,
    single,
  };
}

function buildRpcClient(result: {
  data: (typeof INSERTED)[] | null;
  error: { message: string } | null;
}) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('insertPreparedVtuTransactionDirect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('inserts the payload and returns the prepared projection', async () => {
    const { client, from, insert, select } = buildDirectClient({
      data: INSERTED,
      error: null,
    });

    await expect(
      insertPreparedVtuTransactionDirect(client, PAYLOAD)
    ).resolves.toEqual(INSERTED);
    expect(from).toHaveBeenCalledWith('vtu_transactions');
    expect(insert).toHaveBeenCalledWith(PAYLOAD);
    expect(select).toHaveBeenCalledWith(
      'id, amount, customer_identifier, metadata, request_reference, status, type'
    );
  });

  it.each([
    ['row error', { data: INSERTED, error: { message: 'db down' } }],
    ['missing row', { data: null, error: null }],
  ])('throws the whitelisted error on %s', async (_label, result) => {
    const { client } = buildDirectClient(result);

    await expect(
      insertPreparedVtuTransactionDirect(client, PAYLOAD)
    ).rejects.toThrow('Failed to initiate purchase');
  });
});

describe('insertPreparedVtuTransactionViaRpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the prepare RPC with the mapped params and returns the row', async () => {
    const { client, rpc } = buildRpcClient({ data: [INSERTED], error: null });

    await expect(
      insertPreparedVtuTransactionViaRpc(client, PAYLOAD, 'user-1')
    ).resolves.toEqual(INSERTED);
    expect(rpc).toHaveBeenCalledWith('insert_prepared_vtu_transaction', {
      p_merchant_id: 'merchant-1',
      p_customer_id: 'customer-1',
      p_user_id: 'user-1',
      p_order_id: 'order-1',
      p_type: 'airtime',
      p_network_provider: 'mtn',
      p_phone_number: '08012345678',
      p_amount: 500,
      p_request_reference: 'req-1',
      p_source: 'checkout',
      p_platform_commission: null,
      p_merchant_commission: null,
      p_customer_cashback: null,
      p_biller_name: null,
      p_biller_item_code: null,
      p_customer_identifier: '08012345678',
      p_customer_name: null,
      p_metadata: { walletDebited: false },
    });
  });

  it('defaults source and metadata when the payload omits them', async () => {
    const { client, rpc } = buildRpcClient({ data: [INSERTED], error: null });
    const { source: _source, metadata: _metadata, ...rest } = PAYLOAD;

    await insertPreparedVtuTransactionViaRpc(
      client,
      rest as VtuTransactionInsertPayload & { customer_id: string },
      'user-1'
    );

    const params = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(params.p_source).toBe('checkout');
    expect(params.p_metadata).toEqual({});
  });

  it.each([
    ['row error', { data: [INSERTED], error: { message: 'db down' } }],
    ['empty rows', { data: [], error: null }],
    ['missing rows', { data: null, error: null }],
  ])('throws the whitelisted error on %s', async (_label, result) => {
    const { client } = buildRpcClient(result);

    await expect(
      insertPreparedVtuTransactionViaRpc(client, PAYLOAD, 'user-1')
    ).rejects.toThrow('Failed to initiate purchase');
  });
});
