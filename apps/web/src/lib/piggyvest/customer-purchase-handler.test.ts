import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestCustomerPurchaseHandler } from './customer-purchase-handler';

vi.mock('server-only', () => ({}));
const goalId = '30000000-0000-4000-8000-000000000001';
function fixture(authenticated = true) {
  const from = vi.fn();
  const execute = vi.fn();
  const checkCsrfProtection = vi.fn().mockResolvedValue({ valid: true });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: authenticated ? { id: goalId } : null },
    error: null,
  });
  const handler = createPiggyvestCustomerPurchaseHandler({
    supabase: { auth: { getUser }, from } as unknown as SupabaseClient,
    goalId,
    configuration: {},
    execute,
    checkCsrfProtection,
  });
  return { handler, from, execute, checkCsrfProtection, getUser };
}
function request(body: unknown) {
  return new NextRequest('http://localhost/purchase/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
it('authenticates before CSRF, body and protected queries', async () => {
  const test = fixture(false);
  const response = await test.handler.quote(request({}));
  expect(response.status).toBe(401);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(test.checkCsrfProtection).not.toHaveBeenCalled();
  expect(test.from).not.toHaveBeenCalled();
});
it('rejects CSRF before queries', async () => {
  const test = fixture();
  test.checkCsrfProtection.mockResolvedValue({ valid: false });
  expect((await test.handler.quote(request({}))).status).toBe(403);
  expect(test.from).not.toHaveBeenCalled();
});
it.each([
  { price: 1 },
  { actorId: goalId },
  { fulfilmentMode: 'delivery' },
  { savingsKobo: 0 },
])('rejects browser authority and unsupported pickup input %j', async (extra) => {
  const test = fixture();
  expect(
    (
      await test.handler.quote(
        request({
          goalId,
          quoteId: goalId,
          shippingRateId: goalId,
          savingsKobo: 1,
          fulfilmentMode: 'pickup',
          ...extra,
        })
      )
    ).status
  ).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});
it('requires both exact goal and operation for status', async () => {
  const test = fixture();
  const response = await test.handler.status(
    new NextRequest(`http://localhost/purchase/status?goalId=${goalId}`)
  );
  expect(response.status).toBe(400);
  expect(test.from).not.toHaveBeenCalled();
});
