import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { expect, it, vi } from 'vitest';
import { replayAdmittedOxygenOrder } from './replay-admitted-oxygen-order';

function setup(data: Record<string, unknown> | null) {
  const maybeSingle = vi.fn().mockResolvedValue({ data, error: null });
  const eq = vi.fn();
  const filters = { eq, maybeSingle };
  eq.mockReturnValue(filters);
  const from = vi
    .fn()
    .mockReturnValue({ select: vi.fn().mockReturnValue(filters) });
  return {
    args: {
      client: { from } as unknown as SupabaseClient,
      merchantId: 'merchant',
      userId: 'user',
      key: 'owned-attempt-key',
      hash: 'matching-checkout-hash',
      rejection: NextResponse.json({ error: 'Closed' }, { status: 409 }),
    },
    from,
    eq,
  };
}

it('returns an exact owned Oxygen order without writing or exposing owner details', async () => {
  const { args, eq } = setup({
    id: 'order',
    payment_method: 'oxygen',
    payment_status: 'unpaid',
    total: 120,
    currency: 'NGN',
    amount_paid: 20,
    customers: { user_id: 'user', merchant_id: 'merchant' },
  });
  const response = await replayAdmittedOxygenOrder(args);
  expect(eq.mock.calls).toEqual([
    ['merchant_id', 'merchant'],
    ['customers.merchant_id', 'merchant'],
    ['customers.user_id', 'user'],
    ['checkout_idempotency_key', 'owned-attempt-key'],
    ['checkout_request_hash', 'matching-checkout-hash'],
    ['payment_method', 'oxygen'],
  ]);
  expect(response.headers.get('x-idempotency-replayed')).toBe('true');
  expect(await response.json()).toEqual({
    order: {
      id: 'order',
      payment_method: 'oxygen',
      payment_status: 'unpaid',
      total: 120,
      currency: 'NGN',
    },
    wallet: null,
    savings: null,
    amountDueToGateway: 100,
    idempotency: { replayed: true },
  });
});

it.each([
  { userId: null },
  { key: null },
  { hash: null },
])('does not probe without the full scoped replay identity %j', async (override) => {
  const { args, from } = setup(null);
  await expect(
    replayAdmittedOxygenOrder({ ...args, ...override })
  ).resolves.toBe(args.rejection);
  expect(from).not.toHaveBeenCalled();
});

it('preserves the rollout rejection when no exact owned Oxygen order is found', async () => {
  const { args } = setup(null);
  await expect(replayAdmittedOxygenOrder(args)).resolves.toBe(args.rejection);
});

it.each([
  { shipping_status: 'cancelled' },
  { shipping_status: 'processing' },
  { shipping_status: 'delivered' },
  { payment_status: 'bnpl_approved' },
  { payment_status: 'refunded' },
  { cancelled_at: '2026-11-21T09:00:00Z' },
  { total: 0 },
  { currency: 'USD' },
])('does not report a closed or unfinanceable order as replayed: %j', async (patch) => {
  const { args } = setup({
    id: 'order',
    payment_status: 'unpaid',
    shipping_status: 'pending',
    currency: 'NGN',
    total: 120,
    ...patch,
  });
  const response = await replayAdmittedOxygenOrder(args);
  expect(response.status).toBe(409);
  expect(response.headers.get('x-idempotency-replayed')).toBeNull();
  await expect(response.json()).resolves.toMatchObject({
    code: 'CHECKOUT_ORDER_NOT_REUSABLE',
  });
});
