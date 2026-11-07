import { afterEach, expect, it, vi } from 'vitest';
import { signInWithApple, signInWithGoogle } from './customer-auth-oauth';

afterEach(() => vi.restoreAllMocks());
it.each([
  ['Google', signInWithGoogle, '/api/storefront/auth/google'],
  ['Apple', signInWithApple, '/api/storefront/auth/apple'],
] as const)('requests the %s provider with a checkout return destination', async (_name, signIn, endpoint) => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: false,
    json: async () => ({ error: 'Unavailable' }),
  } as Response);
  expect(await signIn('ogabassey', '/ogabassey/checkout?resume=1')).toEqual({
    success: false,
    error: 'Unavailable',
  });
  expect(fetchMock).toHaveBeenCalledWith(
    endpoint,
    expect.objectContaining({
      body: expect.stringContaining(
        'next=%2Fogabassey%2Fcheckout%3Fresume%3D1'
      ),
    })
  );
});
