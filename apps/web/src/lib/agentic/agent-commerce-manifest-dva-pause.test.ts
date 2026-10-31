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

describe('agent commerce manifest while the Paystack DVA mode is paused', () => {
  beforeEach(() => {
    vi.resetModules();
    stubBaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('removes only Paystack bank transfer while the DVA mode is paused', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');

    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const manifest = buildAgentCommerceManifest(
      {
        business_name: 'Ogabassey',
        feature_settings: { pay_on_delivery_enabled: true },
        paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
        slug: 'ogabassey',
      },
      'https://ogabassey.com'
    );

    expect(manifest.payment_methods).toEqual(['pay_on_delivery']);
    expect(manifest.capabilities).toContain('checkout.session.complete');
    expect(manifest.links.checkout_session_complete).toBeDefined();
  });

  it('removes checkout mutations when paused DVA is the only payment method', async () => {
    vi.stubEnv('AGENTIC_PAYSTACK_DVA_MODE', 'paused');

    const { buildAgentCommerceManifest } = await import(
      '@/lib/agentic/agent-commerce-manifest'
    );

    const manifest = buildAgentCommerceManifest(
      {
        business_name: 'Ogabassey',
        feature_settings: { pay_on_delivery_enabled: false },
        paystack_subaccount_code: 'ACCT_TESTMOCK1234567',
        slug: 'ogabassey',
      },
      'https://ogabassey.com'
    );

    expect(manifest.payment_methods).toEqual([]);
    expect(manifest.capabilities).toEqual(['catalog.read', 'order.read']);
    expect(manifest.links.checkout_session_complete).toBeUndefined();
  });
});
