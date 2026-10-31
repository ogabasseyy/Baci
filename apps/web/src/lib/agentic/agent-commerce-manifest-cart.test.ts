// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'ogabassey');
  vi.stubEnv('OPENAI_AGENTIC_API_KEY', 'agent-api-key');
  vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', 'confirmation-key');
  vi.stubEnv('OPENAI_AGENTIC_SIGNING_KEY', 'signing-key');
  vi.stubEnv('SUPABASE_JWT_SECRET', 'supabase-jwt-secret');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
}

const MERCHANT = {
  business_name: 'Ogabassey',
  feature_settings: { pay_on_delivery_enabled: true },
  paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
  slug: 'ogabassey',
};

describe('agent commerce manifest cart transfer', () => {
  beforeEach(() => {
    vi.resetModules();
    stubBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('grants cart.transfer to a merchant enrolled in shared cart', async () => {
    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const manifest = buildAgentCommerceManifest(
      { ...MERCHANT, shared_cart_enabled: true },
      'https://ogabassey.com'
    );

    expect(manifest.capabilities).toContain('cart.transfer');
  });

  it('withholds cart.transfer from a merchant that is not enrolled', async () => {
    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const notEnrolled = buildAgentCommerceManifest(
      MERCHANT,
      'https://ogabassey.com'
    );
    const disabled = buildAgentCommerceManifest(
      { ...MERCHANT, shared_cart_enabled: false },
      'https://ogabassey.com'
    );

    expect(notEnrolled.capabilities).not.toContain('cart.transfer');
    expect(disabled.capabilities).not.toContain('cart.transfer');
  });

  it('withholds cart.transfer when signed agent access is not configured', async () => {
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', '');

    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const manifest = buildAgentCommerceManifest(
      { ...MERCHANT, shared_cart_enabled: true },
      'https://ogabassey.com'
    );

    expect(manifest.auth).toBeNull();
    expect(manifest.capabilities).not.toContain('cart.transfer');
  });
});
