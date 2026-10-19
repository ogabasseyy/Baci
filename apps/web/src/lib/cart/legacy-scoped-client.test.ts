import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon',
}));
const mockSign = vi.hoisted(() =>
  vi.fn(
    (_payload: Record<string, unknown>, _signer: unknown) => 'signed.jwt.token'
  )
);
vi.mock('@/lib/agentic/jwt-signing-material', () => ({
  getAgenticJwtSigningMaterial: () => ({ type: 'test' }),
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mockSign,
}));

import { createLegacyOwnerScopedClient } from './legacy-scoped-client';

it('attests only the verified holder descriptor with a bounded bootstrap shopper JWT', () => {
  const principal = {
    merchantId: 'merchant',
    principalId: 'legacy:verified',
    scope: 'bootstrap' as const,
    cartId: null,
    grantId: null,
    allowedOperations: [],
    expiresAt: '2099-01-01T00:00:00Z',
  };
  createLegacyOwnerScopedClient(principal, {
    provider: 'ucp',
    hash: 'a'.repeat(64),
    agentId: 'signed-agent',
  });
  expect(mockSign).toHaveBeenCalledWith(
    expect.objectContaining({
      role: 'commerce_cart_shopper',
      cart_scope: 'bootstrap',
      cart_merchant_id: 'merchant',
      cart_principal_id: 'legacy:verified',
      cart_legacy_provider: 'ucp',
      cart_legacy_agent_id: 'signed-agent',
      cart_legacy_hash: 'a'.repeat(64),
    }),
    expect.anything()
  );
  const payload = mockSign.mock.calls[0][0] as Record<string, unknown>;
  expect((payload.exp as number) - (payload.iat as number)).toBe(300);
  expect(payload).not.toHaveProperty('cart_id');
  expect(payload).not.toHaveProperty('cart_grant_id');
});
