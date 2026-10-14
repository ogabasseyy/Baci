import type { SupabaseClient, User } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import {
  createCartAccountScopedClient,
  createCartScopedClient,
} from './scoped-client';
import { verifyCartCustomer } from './verified-customer';

const merchant = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const principal = {
  merchantId: merchant,
  cartId: null,
  grantId: null,
  principalId: 'guest',
  scope: 'bootstrap' as const,
  allowedOperations: [],
  expiresAt: '2099-01-01T00:00:00Z',
};
it('mints account-linker authority only from verified customer ownership and keeps shopper claims separate', async () => {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { id: userId, user_id: userId, merchant_id: merchant },
      error: null,
    }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  const verified = await verifyCartCustomer(principal, {
    error: null,
    user: { id: userId } as User,
    supabase: { from: () => query } as unknown as SupabaseClient,
  });
  if (!verified.ok) throw new Error('fixture did not verify');
  const options = {
    now: new Date('2026-10-14T00:00:00Z'),
    anonKey: 'test-anon-key',
    supabaseUrl: 'https://example.supabase.co',
    signer: {
      type: 'legacy-secret' as const,
      secret: 'test-account-linker-secret-with-enough-length-001',
    },
  };
  const decode = (client: SupabaseClient) => {
    const bearer =
      (client as unknown as { rest: { headers: Headers } }).rest.headers.get(
        'Authorization'
      ) ?? '';
    return JSON.parse(
      Buffer.from(bearer.split('.')[1], 'base64url').toString('utf8')
    ) as Record<string, unknown>;
  };
  const claims = decode(
    createCartAccountScopedClient(principal, verified.customer, options)
  );
  expect(claims).toMatchObject({
    role: 'commerce_cart_account_linker',
    cart_account_user_id: userId,
    cart_customer_id: userId,
    cart_merchant_id: merchant,
  });
  expect(decode(createCartScopedClient(principal, options))).not.toHaveProperty(
    'cart_account_user_id'
  );
  expect(() =>
    createCartAccountScopedClient(
      { ...principal, merchantId: userId },
      verified.customer,
      options
    )
  ).toThrow();
});
