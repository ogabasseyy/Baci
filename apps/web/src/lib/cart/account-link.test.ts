import type { SupabaseClient, User } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { linkCartToCustomer } from './account-link';
import { verifyCartCustomer } from './verified-customer';

vi.mock('./scoped-client', () => ({
  createCartScopedClient: vi.fn(),
  createCartAccountScopedClient: vi.fn(),
}));
vi.mock('./service', () => ({ getCart: vi.fn() }));

import { getCart } from './service';

const merchantId = '11111111-1111-4111-8111-111111111111';
const cartId = '22222222-2222-4222-8222-222222222222';
const customerId = '33333333-3333-4333-8333-333333333333';
const principal = {
  merchantId,
  cartId,
  grantId: customerId,
  principalId: 'guest',
  scope: 'session' as const,
  allowedOperations: ['clear' as const],
  expiresAt: '2099-01-01T00:00:00Z',
};
async function customer() {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: customerId, merchant_id: merchantId, user_id: customerId },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const result = await verifyCartCustomer(principal, {
    user: { id: customerId } as User,
    supabase: { from: () => query } as unknown as SupabaseClient,
    error: null,
  });
  if (!result.ok) throw new Error('fixture did not verify');
  return result.customer;
}
it('uses the atomic account RPC and reconciles the resulting proof-scoped snapshot', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      cartId,
      grantId: customerId,
      principalId: 'customer-device:rotated',
    },
    error: null,
  });
  const cart = {
    merchantId,
    cartId,
    version: 1,
    state: 'active' as const,
    currency: 'NGN',
    lines: [],
    subtotalMinor: 0,
    totalMinor: 0,
    estimatedTotals: false,
    expiresAt: '2099-01-01T00:00:00Z',
  };
  vi.mocked(getCart).mockResolvedValue({
    ok: true,
    cart,
    operationId: '',
    replayed: false,
    warnings: [],
  });
  const result = await linkCartToCustomer(
    principal,
    await customer(),
    { operationId: 'link-one', choice: 'keep_current' },
    {
      accountClient: { rpc },
      snapshotClient: () => ({}) as SupabaseClient,
      environment: 'test',
      destination: { type: 'native', app: 'storefront' },
    }
  );
  expect(result).toMatchObject({ ok: true, cart, grantId: customerId });
  expect(rpc).toHaveBeenCalledWith(
    'commerce_cart_link_account',
    expect.objectContaining({
      p_input: { operationId: 'link-one', choice: 'keep_current' },
      p_source_token_hash: null,
    })
  );
  expect(getCart).toHaveBeenCalledWith(
    expect.objectContaining({
      principal: expect.objectContaining({
        merchantId,
        cartId,
        grantId: customerId,
        principalId: 'customer-device:rotated',
      }),
    })
  );
});
it('does not downgrade to another cart or expose provider details when linking fails', async () => {
  const rpc = vi
    .fn()
    .mockResolvedValue({ data: null, error: { message: 'private detail' } });
  expect(
    await linkCartToCustomer(
      principal,
      await customer(),
      { operationId: 'link-two', choice: 'keep_current' },
      {
        accountClient: { rpc },
        snapshotClient: () => ({}) as SupabaseClient,
        environment: 'test',
        destination: { type: 'web' },
      }
    )
  ).toEqual({ ok: false, code: 'temporarily_unavailable' });
});

it('hashes the merge capability and rejects a receipt paired with another cart snapshot', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      ok: true,
      cartId,
      grantId: customerId,
      principalId: 'customer-device:rotated',
    },
    error: null,
  });
  vi.mocked(getCart).mockResolvedValue({
    ok: true,
    cart: {
      merchantId,
      cartId: customerId,
      version: 1,
      state: 'active',
      currency: 'NGN',
      lines: [],
      subtotalMinor: 0,
      totalMinor: 0,
      estimatedTotals: false,
      expiresAt: '2099-01-01T00:00:00Z',
    },
    operationId: '',
    replayed: false,
    warnings: [],
  });
  const result = await linkCartToCustomer(
    principal,
    await customer(),
    {
      operationId: 'merge-one',
      choice: 'merge',
      expectedSavedCartId: cartId,
      expectedCurrentVersion: 1,
      expectedSavedVersion: 1,
      lines: [],
    },
    {
      accountClient: { rpc },
      snapshotClient: () => ({}) as SupabaseClient,
      secret: 'local-fixture-signing-material-0000000000',
      environment: 'test',
      destination: { type: 'web' },
    }
  );
  expect(result).toEqual({ ok: false, code: 'temporarily_unavailable' });
  const args = rpc.mock.calls[0][1];
  expect(args.p_source_token_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(args.p_handoff_id).toMatch(/^[a-f0-9-]{36}$/);
  expect(JSON.stringify(args)).not.toContain('ch1.');
});
it('rejects a customer from another merchant before making an account RPC', async () => {
  const rpc = vi.fn();
  const result = await linkCartToCustomer(
    { ...principal, merchantId: customerId },
    await customer(),
    { operationId: 'foreign', choice: 'keep_current' },
    {
      accountClient: { rpc },
      environment: 'test',
      destination: { type: 'web' },
    }
  );
  expect(result).toEqual({ ok: false, code: 'unauthorized' });
  expect(rpc).not.toHaveBeenCalled();
});
