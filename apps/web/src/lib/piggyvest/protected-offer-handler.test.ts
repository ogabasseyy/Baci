import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestProtectedOfferHandler } from './protected-offer-handler';

vi.mock('server-only', () => ({}));
const identity = vi.hoisted(() => 'abcdef00-0000-4000-8000-000000000001');
vi.mock('./customer-policy-context', () => ({
  resolvePiggyvestCustomerPolicyContext: async () => ({
    status: 'ready',
    actorId: identity,
    configuration: {
      environment: 'staging',
      integrationId: identity,
      merchantId: identity,
      customerId: identity,
      goalId: identity,
      expectedBusinessId: 'synthetic',
    },
  }),
}));
const receipt = {
  goalId: identity,
  offerId: identity,
  revisionId: identity,
  device: { productId: identity, variantId: null, condition: 'new' },
  priceKobo: 98000,
  termsVersion: 'synthetic',
  termsHash: 'a'.repeat(64),
  startsAt: '2026-09-12T12:00:00Z',
  expiresAt: '2026-09-19T12:00:00Z',
  scope: 'device_price_only',
  purchase: 'requires_confirmation',
  dispatch: 'disabled',
};
function fixture(authenticated = true) {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const csrf = vi.fn().mockResolvedValue({ valid: true });
  const getUser = vi.fn().mockResolvedValue({
    data: { user: authenticated ? { id: identity } : null },
    error: null,
  });
  const options = {
    supabase: { auth: { getUser } } as unknown as SupabaseClient,
    goalId: identity,
    configuration: {},
    execute,
    checkCsrfProtection: csrf,
  };
  return {
    options,
    execute,
    csrf,
    handler: createPiggyvestProtectedOfferHandler(options),
  };
}
const request = (body: unknown) =>
  new NextRequest('http://localhost/protected-offer/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const selection = { goalId: identity, offerId: identity };
it('normalizes uppercase goal and offer identifiers before authentication scope comparison', async () => {
  const test = fixture();
  const response = await test.handler.publish(
    request({ goalId: identity.toUpperCase(), offerId: identity.toUpperCase() })
  );
  expect(response.status).toBe(200);
});
it('authenticates before CSRF or SQL', async () => {
  const test = fixture(false);
  expect((await test.handler.publish(request(selection))).status).toBe(401);
  expect(test.csrf).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});
it('publishes sanitized immutable promise without acknowledgment', async () => {
  const test = fixture();
  expect(await (await test.handler.publish(request(selection))).json()).toEqual(
    { status: 'published', receipt }
  );
  expect(test.execute.mock.calls[0][1]).toEqual([
    identity,
    identity,
    identity,
    identity,
    'synthetic',
    identity,
    identity,
  ]);
});
it('rejects client economics and redacts invalid database output', async () => {
  const test = fixture();
  expect(
    (await test.handler.publish(request({ ...selection, priceKobo: 1 }))).status
  ).toBe(400);
  expect(test.execute).not.toHaveBeenCalled();
  test.execute.mockResolvedValue({
    rows: [{ result: { ...receipt, providerSecret: 'never expose' } }],
  });
  const response = await test.handler.publish(request(selection));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('never expose');
});
it('rejects CSRF and cross-goal requests before dispatch', async () => {
  const test = fixture();
  test.csrf.mockResolvedValue({ valid: false });
  expect((await test.handler.publish(request(selection))).status).toBe(403);
  test.csrf.mockResolvedValue({ valid: true });
  expect(
    (
      await test.handler.publish(
        request({ ...selection, goalId: identity.replace(/1$/, '2') })
      )
    ).status
  ).toBe(403);
  expect(test.execute).not.toHaveBeenCalled();
});
it('correlates alias readback with requested identifier rather than original receipt identifier', async () => {
  const test = fixture();
  const requestedOfferId = identity.replace(/1$/, '2');
  const observation = {
    status: 'observed',
    requestedOfferId,
    receipt,
    observedAt: '2026-09-13T12:00:00Z',
    pricePromise: 'active',
    funds: 'requires_checkout_review',
  };
  test.execute.mockResolvedValue({ rows: [{ result: observation }] });
  const lookup = () =>
    new NextRequest(
      `http://localhost/protected-offer/status?goalId=${identity}&offerId=${requestedOfferId}`
    );
  expect(await (await test.handler.status(lookup())).json()).toEqual(
    observation
  );
  test.execute.mockResolvedValue({
    rows: [{ result: { ...observation, requestedOfferId: identity } }],
  });
  expect((await test.handler.status(lookup())).status).toBe(503);
});
