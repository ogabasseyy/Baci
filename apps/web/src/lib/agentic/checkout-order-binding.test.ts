import { beforeEach, expect, it, vi } from 'vitest';
import { submitCartBoundOrder } from '@/lib/cart/order-binding';
import { submitSharedCartBindingOrder } from './checkout-order-binding';

vi.mock('@/lib/cart/order-binding', () => ({
  submitCartBoundOrder: vi.fn(),
}));

const sharedCart = {
  cart_id: '22222222-2222-4222-8222-222222222222',
  cart_version: 3,
  checkout_generation: 2,
  checkout_session_id: '44444444-4444-4444-8444-444444444444',
};
const orderRpcArgs = { p_merchant_id: 'merchant-1' };

beforeEach(() => vi.resetAllMocks());

it('resolves a bound order for the caller mapper', async () => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: true,
    order: { id: 'order-1', total: 100 },
    binding: {},
    replayed: false,
  } as never);
  const outcome = await submitSharedCartBindingOrder({
    supabase: {} as never,
    sharedCart,
    orderRpcArgs,
    boundPrincipalId: 'owner-1',
  });
  expect(outcome).toEqual({
    kind: 'resolved',
    data: { id: 'order-1', total: 100 },
    error: null,
  });
  expect(submitCartBoundOrder).toHaveBeenCalledWith(
    { client: {} },
    {
      args: orderRpcArgs,
      cartId: sharedCart.cart_id,
      cartVersion: 3,
      generation: 2,
      principalId: 'owner-1',
      sessionId: sharedCart.checkout_session_id,
      variant: 'base',
    }
  );
});

it('maps voucher authority to the website completion failure', async () => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: false,
    code: 'order_rejected',
    message: 'cart_order_voucher_authority_required',
  });
  const outcome = await submitSharedCartBindingOrder({
    supabase: {} as never,
    sharedCart,
    orderRpcArgs,
  });
  expect(outcome.kind).toBe('failure');
  if (outcome.kind !== 'failure') throw new Error('expected failure');
  expect(outcome.result.status).toBe(409);
  expect(outcome.result.data).toMatchObject({
    code: 'voucher_checkout_requires_website',
  });
});

it.each([
  ['unauthorized', 403],
  ['invalid_item', 500],
  ['expired', 409],
  ['not_found', 409],
  ['refresh_required', 409],
] as const)('maps binding failure %s to status %s', async (code, status) => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: false,
    code,
    message: 'private details',
  });
  const outcome = await submitSharedCartBindingOrder({
    supabase: {} as never,
    sharedCart,
    orderRpcArgs,
  });
  expect(outcome.kind).toBe('failure');
  if (outcome.kind !== 'failure') throw new Error('expected failure');
  expect(outcome.result.status).toBe(status);
  expect(JSON.stringify(outcome.result.data)).not.toContain('private details');
});

it('resolves inner order rejections in direct-path shape', async () => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: false,
    code: 'order_rejected',
    message: 'order_total_mismatch',
  });
  const outcome = await submitSharedCartBindingOrder({
    supabase: {} as never,
    sharedCart,
    orderRpcArgs,
  });
  expect(outcome).toEqual({
    kind: 'resolved',
    data: null,
    error: { code: 'order_total_mismatch', message: 'order_total_mismatch' },
  });
});

it('resolves temporary unavailability as a generic inner error', async () => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: false,
    code: 'temporarily_unavailable',
    message: 'database offline',
  });
  const outcome = await submitSharedCartBindingOrder({
    supabase: {} as never,
    sharedCart,
    orderRpcArgs,
  });
  expect(outcome).toEqual({
    kind: 'resolved',
    data: null,
    error: { code: 'XX000', message: 'database offline' },
  });
});
