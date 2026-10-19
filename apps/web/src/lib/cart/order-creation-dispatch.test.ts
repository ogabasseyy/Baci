import { createClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { submitCartBoundOrder } from './order-binding';
import { dispatchOrderCreation } from './order-creation-dispatch';

vi.mock('./order-binding', () => ({ submitCartBoundOrder: vi.fn() }));

const binding = {
  cart_id: 'cart',
  cart_version: 3,
  checkout_generation: 2,
  checkout_session_id: 'session',
};
const client = createClient('https://db.invalid', 'fixture-key');
const args = { p_merchant_id: 'merchant' };

beforeEach(() => vi.resetAllMocks());

it('dispatches legacy orders through the variant RPC when unbound', async () => {
  const rpc = vi.fn(async () => ({ data: [{ id: 'order-1' }], error: null }));
  const result = await dispatchOrderCreation({
    args,
    binding: undefined,
    client: { rpc } as never,
    principalId: null,
    rpcName: 'create_storefront_order',
    variant: 'base',
  });
  expect(result).toEqual({
    failure: null,
    orderRows: [{ id: 'order-1' }],
    orderError: null,
  });
  expect(rpc).toHaveBeenCalledWith('create_storefront_order', args);
  expect(submitCartBoundOrder).not.toHaveBeenCalled();
});

it('maps bound inner rejections to the legacy mapper shape', async () => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: false,
    code: 'order_rejected',
    message: 'order_total_mismatch',
  });
  const result = await dispatchOrderCreation({
    args,
    binding,
    client,
    principalId: 'owner',
    rpcName: 'create_storefront_order',
    variant: 'base',
  });
  expect(result).toEqual({
    failure: null,
    orderRows: null,
    orderError: { code: 'P0001', message: 'order_total_mismatch' },
  });
});
