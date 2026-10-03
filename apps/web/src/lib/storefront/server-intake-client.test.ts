import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitStorefrontProductRequest } from './server-intake-client';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createServiceClient: vi.fn(),
}));
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: mocks.createServiceClient,
}));
vi.mock('server-only', () => ({}));

beforeEach(() => {
  mocks.rpc.mockReset().mockResolvedValue({ error: null });
  mocks.createServiceClient.mockReset().mockReturnValue({ rpc: mocks.rpc });
});

describe('server intake client', () => {
  it('exposes exactly the submit RPC through the branded intake client', async () => {
    const args = {
      p_query: 'iPhone 20',
      p_contact: 'shopper@example.com',
      p_merchant_slug: 'ogabassey',
      p_request_id: '11111111-1111-4111-8111-111111111111',
    };
    await expect(submitStorefrontProductRequest(args)).resolves.toEqual({
      error: null,
    });
    expect(mocks.createServiceClient).toHaveBeenCalledWith(
      'storefront-public-intake'
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'submit_storefront_product_request',
      args
    );
  });
});
