import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';
import { createPiggyvestDeviceChangeHandler } from './device-change-handler';

vi.mock('server-only', () => ({}));
const identity = vi.hoisted(() => '30000000-0000-4000-8000-000000000001');
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
const terms = {
  version: 'synthetic-v1',
  text: 'Synthetic device change terms',
  hash: createHash('sha256')
    .update('Synthetic device change terms')
    .digest('hex'),
};
const quote = {
  goalId: identity,
  quoteId: identity,
  revisionId: identity,
  priorRevisionId: identity,
  device: {
    productId: identity,
    variantId: null,
    productName: 'Synthetic exact device',
    variant: null,
    condition: 'new',
  },
  priceKobo: 100,
  durationMonths: null,
  termsVersion: terms.version,
  termsHash: terms.hash,
  maturesAt: null,
  graceExpiresAt: null,
  expiresAt: '2099-01-01T00:00:00Z',
};
function fixture(authenticated = true) {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: quote }] });
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
    termsDocument: terms,
  };
  return {
    options,
    execute,
    csrf,
    handler: createPiggyvestDeviceChangeHandler(options),
  };
}
const request = (body: unknown) =>
  new NextRequest('http://localhost/device-change/quote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const selection = {
  goalId: identity,
  quoteId: identity,
  productId: identity,
  variantId: null,
};
it('authenticates before CSRF or SQL', async () => {
  const test = fixture(false);
  expect((await test.handler.quote(request(selection))).status).toBe(401);
  expect(test.csrf).not.toHaveBeenCalled();
  expect(test.execute).not.toHaveBeenCalled();
});
it('returns only exact published selection and matching server terms', async () => {
  const test = fixture();
  const response = await test.handler.quote(request(selection));
  expect(await response.json()).toEqual({
    status: 'quote_available',
    quote,
    terms,
  });
  expect(test.execute.mock.calls[0][1]).toEqual([
    identity,
    identity,
    identity,
    identity,
    'synthetic',
    identity,
    JSON.stringify({ quoteId: identity, productId: identity, variantId: null }),
  ]);
});
it('rejects monetary/terms authority and wrong goal before SQL', async () => {
  for (const body of [
    { ...selection, termsHash: terms.hash },
    { ...selection, priceKobo: 1 },
    { ...selection, goalId: '30000000-0000-4000-8000-000000000002' },
  ]) {
    const test = fixture();
    expect([400, 403]).toContain(
      (await test.handler.quote(request(body))).status
    );
    expect(test.execute).not.toHaveBeenCalled();
  }
});
it('fails closed on mismatching terms or privileged result fields', async () => {
  for (const result of [
    { ...quote, termsHash: 'b'.repeat(64) },
    { ...quote, actorId: identity },
  ]) {
    const test = fixture();
    test.execute.mockResolvedValue({ rows: [{ result }] });
    expect((await test.handler.quote(request(selection))).status).toBe(503);
  }
});
