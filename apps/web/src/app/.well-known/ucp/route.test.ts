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

describe('GET /.well-known/ucp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    stubBaseEnv();
    stubMerchant();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('publishes a UCP discovery profile for storefront hosts', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/.well-known/ucp', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'no-store, max-age=0, must-revalidate'
    );
    expect(response.headers.get('cdn-cache-control')).toBe('no-store');
    expect(response.headers.get('vercel-cdn-cache-control')).toBe('no-store');
    expect(body.store).toMatchObject({
      slug: 'ogabassey',
      name: 'Ogabassey',
      canonical_origin: 'https://ogabassey.com',
    });
    expect(body.ucp.version).toBe('2026-04-08');
    expect(body.ucp.services).toEqual({});
    expect(body.ucp.capabilities).toMatchObject({
      'com.usebaci.catalog.read': [
        expect.objectContaining({ version: '2026-04-30' }),
      ],
    });
    expect(body.ucp.capabilities['dev.ucp.shopping.checkout']).toBeUndefined();
    expect(body.ucp.payment_handlers).toEqual({});
    expect(body.signing_keys).toEqual([]);
    expect(body.links).toMatchObject({
      agent_commerce_manifest: 'https://ogabassey.com/agent-commerce.json',
      agentic_api_base: 'https://ogabassey.com/api/agentic',
      trust: 'https://ogabassey.com/agent-trust.json',
      product_feed: 'https://ogabassey.com/feeds/openai.jsonl',
    });
    expect(body.extensions.baci.capabilities).toEqual(['catalog.read']);
    expect(mockGetMerchantByIdentifier).toHaveBeenCalledWith('ogabassey.com');
    expect(JSON.stringify(body)).not.toContain('xsoljx');
  });

  it('exposes Baci checkout extensions when agentic checkout is configured', async () => {
    stubAgenticCheckoutEnv();

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/.well-known/ucp', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ucp.services).toEqual({
      'dev.ucp.shopping': [
        {
          endpoint: 'https://ogabassey.com/api/agentic',
          schema:
            'https://ucp.dev/2026-04-08/services/shopping/rest.openapi.json',
          spec: 'https://ucp.dev/2026-04-08/specification/overview',
          transport: 'rest',
          version: '2026-04-08',
        },
      ],
    });
    expect(body.ucp.capabilities['dev.ucp.shopping.checkout']).toEqual([
      expect.objectContaining({
        version: '2026-04-08',
        spec: 'https://ucp.dev/2026-04-08/specification/checkout',
        schema: 'https://ucp.dev/2026-04-08/schemas/shopping/checkout.json',
      }),
    ]);
    expect(
      body.ucp.capabilities['dev.ucp.shopping.catalog.lookup'][0].config.rest
        .operations
    ).toMatchObject({
      get_product: 'https://ogabassey.com/api/agentic/catalog/product',
      lookup_catalog: 'https://ogabassey.com/api/agentic/catalog/lookup',
    });
    expect(
      body.ucp.capabilities['dev.ucp.shopping.checkout'][0].config
    ).toMatchObject({
      auth: {
        type: 'bearer_hmac',
      },
      rest: {
        endpoint: 'https://ogabassey.com/api/agentic',
        operations: {
          cancel_checkout:
            'https://ogabassey.com/api/agentic/checkout-sessions/{id}/cancel',
          complete_checkout:
            'https://ogabassey.com/api/agentic/checkout-sessions/{id}/complete',
          create_checkout:
            'https://ogabassey.com/api/agentic/checkout-sessions',
          get_checkout:
            'https://ogabassey.com/api/agentic/checkout-sessions/{id}',
          update_checkout:
            'https://ogabassey.com/api/agentic/checkout-sessions/{id}',
        },
      },
    });
    expect(body.ucp.capabilities['dev.ucp.shopping.order']).toEqual([
      expect.objectContaining({
        version: '2026-04-08',
        spec: 'https://ucp.dev/2026-04-08/specification/order',
        schema: 'https://ucp.dev/2026-04-08/schemas/shopping/order.json',
      }),
    ]);
    expect(
      body.ucp.capabilities['dev.ucp.shopping.order'][0].config
    ).toMatchObject({
      auth: {
        supported_api_versions: expect.any(Array),
        type: 'bearer_hmac',
      },
      rest: {
        endpoint: 'https://ogabassey.com/api/agentic',
        operations: {
          get_order: 'https://ogabassey.com/api/agentic/orders/{id}',
        },
      },
    });
    expect(body.ucp.payment_handlers).toMatchObject({
      'com.paystack.bank_transfer': [
        expect.objectContaining({
          id: 'paystack_bank_transfer',
          version: '2026-04-08',
        }),
      ],
    });
    expect(body.extensions.baci.capabilities).toContain(
      'checkout.session.complete'
    );
    expect(body.extensions.baci.capabilities).toContain('order.read');
    expect(body.extensions.baci.payment_methods).toEqual([
      'paystack_bank_transfer',
    ]);
    expect(body.extensions.baci.auth?.type).toBe('bearer_hmac');
    expect(body.extensions.baci.links.checkout_sessions).toBe(
      'https://ogabassey.com/api/agentic/checkout_sessions'
    );
    expect(body.extensions.baci.links.order).toBe(
      'https://ogabassey.com/api/agentic/orders/{order_id}'
    );
  });

  it('omits the Paystack handler but preserves pay on delivery while DVA is paused', async () => {
    stubAgenticCheckoutEnv();
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');
    stubMerchant({
      feature_settings: { pay_on_delivery_enabled: true },
    });

    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://ogabassey.com/.well-known/ucp', {
        headers: { host: 'ogabassey.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ucp.payment_handlers).not.toHaveProperty(
      'com.paystack.bank_transfer'
    );
    expect(body.ucp.payment_handlers).toHaveProperty(
      'com.usebaci.pay_on_delivery'
    );
    expect(body.extensions.baci.payment_methods).toEqual(['pay_on_delivery']);
    expect(body.ucp.capabilities['dev.ucp.shopping.checkout']).toBeDefined();
  });

  it('returns a Baci platform profile on the root domain', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/.well-known/ucp', {
        headers: { host: 'usebaci.com' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.platform).toMatchObject({
      name: 'Baci',
      type: 'merchant_platform',
    });
    expect(body.links).toMatchObject({
      merchant_onboarding: 'https://usebaci.com/onboarding',
    });
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('returns 400 when the resolved storefront identifier is invalid', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request('https://usebaci.com/.well-known/ucp', {
        headers: { host: '<script>' },
      })
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('Invalid storefront host');
    expect(mockGetMerchantByIdentifier).not.toHaveBeenCalled();
  });

  it('returns 500 when merchant lookup fails', async () => {
    const errorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockGetMerchantByIdentifier.mockRejectedValue(new Error('lookup failed'));

    try {
      const { GET } = await import('./route');
      const response = await GET(
        new Request('https://ogabassey.com/.well-known/ucp', {
          headers: { host: 'ogabassey.com' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(500);
      expect(body.error).toBe('Failed to build UCP profile');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
