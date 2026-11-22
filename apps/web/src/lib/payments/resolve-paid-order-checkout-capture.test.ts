import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { resolvePaidOrderCheckoutCapture } from './resolve-paid-order-checkout-capture';

const gatewayResponse = {
  amount: 30_000_000,
  channel: 'card',
  currency: 'NGN',
  id: 345,
  integration: 987,
  reference: 'BAC-SYNTHETIC001',
  status: 'success',
};

it('returns the database decision without treating unapplied funds as allocated', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { outcome: 'unapplied' }, error: null });
  const outcome = await resolvePaidOrderCheckoutCapture({
    gatewayResponse,
    reference: gatewayResponse.reference,
    supabase: { rpc } as unknown as SupabaseClient,
  });
  expect(outcome).toBe('unapplied');
  expect(rpc).toHaveBeenCalledWith('resolve_paid_order_checkout_capture', {
    p_reference: gatewayResponse.reference,
    p_verified: gatewayResponse,
    p_platform_fee_minor: expect.any(Number),
  });
});

it('fails closed on an unknown decision or RPC failure', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: { outcome: 'unknown' }, error: null })
    .mockResolvedValueOnce({ data: null, error: { code: '08006' } });
  const args = {
    gatewayResponse,
    reference: gatewayResponse.reference,
    supabase: { rpc } as unknown as SupabaseClient,
  };
  expect(await resolvePaidOrderCheckoutCapture(args)).toBe('unavailable');
  expect(await resolvePaidOrderCheckoutCapture(args)).toBe('unavailable');
});

it.each([
  { reference: gatewayResponse.reference, id: '345', expected: 987 },
  { reference: gatewayResponse.reference, id: '346', expected: undefined },
  { reference: 'BAC-OTHER0000001', id: '345', expected: undefined },
])('only uses signed integration evidence bound to the verified capture', async ({
  reference,
  id,
  expected,
}) => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: { outcome: 'ready' }, error: null });
  await resolvePaidOrderCheckoutCapture({
    gatewayResponse: { ...gatewayResponse, integration: undefined },
    reference: gatewayResponse.reference,
    signedEvent: { reference, id, integration: 987 },
    supabase: { rpc } as unknown as SupabaseClient,
  });
  expect(rpc).toHaveBeenCalledWith(
    'resolve_paid_order_checkout_capture',
    expect.objectContaining({
      p_verified: expect.objectContaining({ integration: expected }),
    })
  );
});

it('preserves the Paystack gross and applies only the fee allocation certified by the database', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: { outcome: 'ready', customerFeeMinor: 17767 },
    error: null,
  });
  const receipt = {
    ...gatewayResponse,
    amount: 517767,
    requested_amount: 500000,
    fees: 17767,
    subaccount: {},
    fees_split: null,
  };
  expect(
    await resolvePaidOrderCheckoutCapture({
      gatewayResponse: receipt,
      reference: receipt.reference,
      supabase: { rpc } as unknown as SupabaseClient,
    })
  ).toBe('ready');
  expect(receipt).toMatchObject({
    amount: 517767,
    baci_paystack_checkout_customer_fee_minor: 17767,
  });
  expect(rpc).toHaveBeenCalledWith(
    'resolve_paid_order_checkout_capture',
    expect.objectContaining({
      p_verified: expect.objectContaining({
        amount: 517767,
        requested_amount: 500000,
        fees: 17767,
        subaccount: {},
      }),
    })
  );
});
