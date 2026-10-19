import { expect, it, vi } from 'vitest';
import { resolveAccountCartRequest } from './account-request';

vi.mock('@/lib/api-auth', () => ({ authenticateApiRequest: vi.fn() }));
vi.mock('./request-context', () => ({ resolveCartRequestContext: vi.fn() }));
vi.mock('./verified-customer', () => ({ verifyCartCustomer: vi.fn() }));

import { authenticateApiRequest } from '@/lib/api-auth';
import { resolveCartRequestContext } from './request-context';
import { verifyCartCustomer } from './verified-customer';

const deps = {
  merchant: { resolveAlias: vi.fn(), rpcClient: { rpc: vi.fn() } },
  verify: vi.fn(),
  requireScope: 'any' as const,
  wrongScopeError: 'not_found' as const,
};
it('authenticates the original shopper JWT and passes only the separate cart proof to cart resolution', async () => {
  const request = new Request('https://shop.test/api/storefront/cart/account', {
    headers: {
      Authorization: 'Bearer shopper-jwt',
      'X-Cart-Session-Proof': 'cp1.payload.signature',
    },
  });
  const context = {
    ok: true as const,
    merchant: { id: 'merchant', slug: 'shop', customDomain: null },
    principal: { merchantId: 'merchant' },
  };
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    user: { id: 'user' },
    supabase: {},
    error: null,
  } as never);
  vi.mocked(resolveCartRequestContext).mockResolvedValue(context as never);
  vi.mocked(verifyCartCustomer).mockResolvedValue({
    ok: true,
    customer: { userId: 'user' },
  } as never);
  expect((await resolveAccountCartRequest(request, deps)).ok).toBe(true);
  expect(authenticateApiRequest).toHaveBeenCalledWith(request);
  expect(
    vi
      .mocked(resolveCartRequestContext)
      .mock.calls.at(-1)?.[0]
      .headers.get('authorization')
  ).toBe('Bearer cp1.payload.signature');
  expect(request.headers.get('authorization')).toBe('Bearer shopper-jwt');
});
it('rejects an explicit malformed cart proof without falling back to a cookie', async () => {
  vi.mocked(resolveCartRequestContext).mockClear();
  const result = await resolveAccountCartRequest(
    new Request('https://shop.test', {
      headers: {
        'X-Cart-Session-Proof': 'malformed',
        cookie: 'baci-cart-shop=cp1.old.signature',
      },
    }),
    deps
  );
  expect(result).toEqual({ ok: false, error: 'invalid_proof' });
  expect(resolveCartRequestContext).not.toHaveBeenCalled();
});
it('stops before cart/customer data access when shopper authentication fails', async () => {
  vi.mocked(authenticateApiRequest).mockResolvedValue({
    user: null,
    supabase: null,
    error: 'invalid',
  });
  vi.mocked(resolveCartRequestContext).mockClear();
  expect(
    await resolveAccountCartRequest(new Request('https://shop.test'), deps)
  ).toEqual({ ok: false, error: 'unauthorized' });
  expect(resolveCartRequestContext).not.toHaveBeenCalled();
});
