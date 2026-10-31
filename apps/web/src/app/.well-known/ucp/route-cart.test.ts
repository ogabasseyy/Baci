// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMerchantByIdentifier = vi.fn();

vi.mock('server-only', () => ({}));

vi.mock('@/lib/cached-data', () => ({
  getMerchantByIdentifier: (...args: unknown[]) =>
    mockGetMerchantByIdentifier(...args),
}));

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', '');
  vi.stubEnv('OPENAI_AGENTIC_API_KEY', '');
  vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', '');
  vi.stubEnv('OPENAI_AGENTIC_SIGNING_KEY', '');
  vi.stubEnv('SUPABASE_JWT_SECRET', '');
  vi.stubEnv('PAYSTACK_SECRET_KEY', '');
}

function stubAgenticCheckoutEnv() {
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'ogabassey');
  vi.stubEnv('OPENAI_AGENTIC_API_KEY', 'agent-api-key');
  vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', 'confirmation-key');
  vi.stubEnv('OPENAI_AGENTIC_SIGNING_KEY', 'signing-key');
  vi.stubEnv('SUPABASE_JWT_SECRET', 'supabase-jwt-secret');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
}

function stubMerchant(overrides: Record<string, unknown> = {}) {
  mockGetMerchantByIdentifier.mockResolvedValue({
    business_name: 'Ogabassey',
    custom_domain: 'ogabassey.com',
    id: 'merchant-1',
    paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
    slug: 'ogabassey',
    ...overrides,
  });
}

describe('GET /.well-known/ucp cart declaration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    stubBaseEnv();
    stubMerchant();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('declares the cart operations for a merchant enrolled in shared cart', async () => {
    stubAgenticCheckoutEnv();
    stubMerchant({ shared_cart_enabled: true });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/.well-known/ucp', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ucp.capabilities['dev.ucp.shopping.cart']).toEqual([
      expect.objectContaining({
        spec: 'https://ucp.dev/2026-04-08/specification/cart',
      }),
    ]);
    expect(
      body.ucp.capabilities['dev.ucp.shopping.cart'][0].config.rest.operations
    ).toMatchObject({
      cancel_cart: 'https://ogabassey.com/api/agentic/carts/{id}/cancel',
      convert_cart_to_checkout:
        'https://ogabassey.com/api/agentic/carts/{id}/checkout',
      create_cart: 'https://ogabassey.com/api/agentic/carts',
      get_cart: 'https://ogabassey.com/api/agentic/carts/{id}',
      update_cart: 'https://ogabassey.com/api/agentic/carts/{id}',
    });
    expect(body.extensions.baci.capabilities).toContain('cart.transfer');
  });

  it('does not declare cart for a merchant that is not enrolled in shared cart', async () => {
    stubAgenticCheckoutEnv();
    stubMerchant({ shared_cart_enabled: false });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/.well-known/ucp', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ucp.capabilities['dev.ucp.shopping.cart']).toBeUndefined();
    expect(body.extensions.baci.capabilities).not.toContain('cart.transfer');
    expect(body.ucp.capabilities['dev.ucp.shopping.checkout']).toBeDefined();
  });
});
