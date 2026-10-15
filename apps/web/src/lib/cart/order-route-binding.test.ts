import { createClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import { submitCartBoundOrder } from './order-binding';
import {
  requestCarriesSharedCartSessionProof,
  verifySharedCartOrderProof,
} from './order-proof';
import {
  getSharedCartOrderAuthority,
  submitSharedCartOrderBinding,
} from './order-route-binding';

vi.mock('./order-proof', () => ({
  requestCarriesSharedCartSessionProof: vi.fn(() => false),
  verifySharedCartOrderProof: vi.fn(),
}));
vi.mock('./order-binding', () => ({ submitCartBoundOrder: vi.fn() }));
const binding = {
  cart_id: 'cart',
  cart_version: 3,
  checkout_generation: 2,
  checkout_session_id: 'session',
};
const request = new Request('https://shop.invalid/api/orders');
const deps = { client: createClient('https://db.invalid', 'fixture-key') };
const input = {
  binding,
  principalId: 'owner',
  args: { p_merchant_id: 'merchant' },
  variant: 'base' as const,
};
beforeEach(() => vi.resetAllMocks());

it('keeps ordinary guest checkout independent of cart proof or binding calls', async () => {
  expect(getSharedCartOrderAuthority(request, undefined, 'merchant')).toEqual({
    ok: true,
    principalId: null,
  });
  expect(verifySharedCartOrderProof).not.toHaveBeenCalled();
  expect(
    await submitSharedCartOrderBinding(deps, { ...input, binding: undefined })
  ).toEqual({ bound: null, failure: null });
  expect(submitCartBoundOrder).not.toHaveBeenCalled();
});
it('fails closed when shared-cart session authority omits its binding', async () => {
  vi.mocked(requestCarriesSharedCartSessionProof).mockReturnValue(true);
  const authority = getSharedCartOrderAuthority(request, undefined, 'merchant');
  expect(authority.ok).toBe(false);
  if (authority.ok) throw new Error('unbound shared authority');
  expect(authority.response.status).toBe(401);
  expect(await authority.response.json()).toMatchObject({
    code: 'SHARED_CART_BINDING_REQUIRED',
  });
  expect(submitCartBoundOrder).not.toHaveBeenCalled();
});
it('forwards only verified preparing-principal authority for the submitted cart and merchant', () => {
  vi.mocked(verifySharedCartOrderProof).mockReturnValue({
    ok: true,
    principalId: 'verified-owner',
  });
  expect(getSharedCartOrderAuthority(request, binding, 'merchant')).toEqual({
    ok: true,
    principalId: 'verified-owner',
  });
  expect(verifySharedCartOrderProof).toHaveBeenCalledWith(request, {
    cartId: 'cart',
    merchantId: 'merchant',
  });
});
it('rejects an unverified bound submit before dispatch', async () => {
  vi.mocked(verifySharedCartOrderProof).mockReturnValue({ ok: false });
  const authority = getSharedCartOrderAuthority(request, binding, 'merchant');
  expect(authority.ok).toBe(false);
  if (authority.ok) throw new Error('unverified authority');
  expect(authority.response.status).toBe(401);
  expect(await authority.response.json()).toMatchObject({
    code: 'SHARED_CART_PROOF_REQUIRED',
  });
  expect(submitCartBoundOrder).not.toHaveBeenCalled();
});
it.each([
  ['refresh_required', 409, 'SHARED_CART_STALE'],
  ['expired', 409, 'SHARED_CART_SESSION_EXPIRED'],
  ['not_found', 409, 'SHARED_CART_SESSION_NOT_FOUND'],
  ['unauthorized', 403, 'SHARED_CART_BINDING_FORBIDDEN'],
  ['invalid_item', 400, 'SHARED_CART_BINDING_FAILED'],
  ['temporarily_unavailable', 503, 'SHARED_CART_TEMPORARILY_UNAVAILABLE'],
] as const)('maps %s to a safe binding response', async (code, status, responseCode) => {
  vi.mocked(submitCartBoundOrder).mockResolvedValue({
    ok: false,
    code,
    message: 'private database details',
  });
  const result = await submitSharedCartOrderBinding(deps, input);
  expect(result.failure?.status).toBe(status);
  const body: unknown = await result.failure?.json();
  expect(body).toMatchObject({ code: responseCode });
  expect(JSON.stringify(body)).not.toContain('private database details');
  expect(submitCartBoundOrder).toHaveBeenCalledWith(deps, {
    args: input.args,
    cartId: 'cart',
    cartVersion: 3,
    generation: 2,
    principalId: 'owner',
    sessionId: 'session',
    variant: 'base',
  });
});
it('preserves inner order rejections for the existing order mapper', async () => {
  const rejection = {
    ok: false as const,
    code: 'order_rejected' as const,
    message: 'order_total_mismatch',
  };
  vi.mocked(submitCartBoundOrder).mockResolvedValue(rejection);
  expect(await submitSharedCartOrderBinding(deps, input)).toEqual({
    bound: rejection,
    failure: null,
  });
});
