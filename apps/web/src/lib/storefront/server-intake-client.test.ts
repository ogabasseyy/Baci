import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { submitStorefrontProductRequest } from './server-intake-client';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }));
vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'public-key',
}));
vi.mock('server-only', () => ({}));
const tokenFor = (role: string) =>
  `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
const args = {
  p_query: 'iPhone 20',
  p_contact: 'shopper@example.com',
  p_merchant_slug: 'ogabassey',
  p_request_id: '11111111-1111-4111-8111-111111111111',
};
beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.createClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
});
afterEach(() => vi.unstubAllEnvs());
describe('restricted server intake', () => {
  it('uses the public gateway key and only the restricted role for submit', async () => {
    const token = tokenFor('storefront_intake');
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', token);
    await expect(submitStorefrontProductRequest(args)).resolves.toEqual({
      error: null,
    });
    const options = mocks.createClient.mock.calls[0][2];
    expect(mocks.createClient).toHaveBeenCalledWith(
      'https://test.supabase.co',
      'public-key',
      expect.any(Object)
    );
    expect(await options.accessToken()).toBe(token);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'submit_storefront_product_request',
      args
    );
  });
  it.each([
    '',
    'malformed',
    tokenFor('service_role'),
    tokenFor('authenticated'),
  ])('rejects an unavailable or privileged credential', (token) => {
    vi.stubEnv('SUPABASE_STOREFRONT_INTAKE_KEY', token);
    expect(() => submitStorefrontProductRequest(args)).toThrow(
      'Restricted storefront intake credential is unavailable'
    );
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});
