// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isAgenticCheckoutRuntimeConfigured,
  resolveAgenticMerchantContextFromRpc,
} from '@/lib/agentic/merchant-context';

// server-only has no runtime exports; mock it so Vitest can import server modules.
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => {
  const getFirstNonBlankEnv = (...keys: string[]) =>
    keys
      .map((key) => process.env[key])
      .find(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0
      );

  return {
    contextRpc: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(
      async () => ({ data: [], error: null })
    ),
    contextClient: vi.fn(),
    getAgenticApiKey: vi.fn(() =>
      getFirstNonBlankEnv('BACI_AGENTIC_ACCESS_TOKEN', 'OPENAI_AGENTIC_API_KEY')
    ),
    getAgenticConfirmationKeys: vi.fn(() => {
      const value = getFirstNonBlankEnv(
        'BACI_AGENTIC_CONFIRMATION_KEY',
        'OPENAI_AGENTIC_CONFIRMATION_KEY'
      );
      return value ? [value] : [];
    }),
    getAgenticMerchantSlug: vi.fn(() =>
      getFirstNonBlankEnv(
        'BACI_AGENTIC_MERCHANT_SLUG',
        'OPENAI_AGENTIC_MERCHANT_SLUG'
      )
    ),
    getAgenticSigningKeys: vi.fn(() => {
      const value = getFirstNonBlankEnv(
        'BACI_AGENTIC_SIGNING_KEY',
        'OPENAI_AGENTIC_SIGNING_KEY'
      );
      return value ? [value] : [];
    }),
    hasUsableAgenticJwtSigningMaterial: vi.fn(() => {
      const privateJwk = process.env.SUPABASE_AGENTIC_JWT_PRIVATE_JWK?.trim();
      if (!privateJwk) {
        return Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
      }

      if (privateJwk === 'invalid-agentic-private-jwk') {
        return Boolean(process.env.SUPABASE_JWT_SECRET?.trim());
      }

      return true;
    }),
  };
});

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticMerchantContextClient: (slug: string) => {
    mocks.contextClient(slug);
    return { rpc: mocks.contextRpc };
  },
}));

vi.mock('@/env', () => ({
  getAgenticApiKey: mocks.getAgenticApiKey,
  getAgenticConfirmationKeys: mocks.getAgenticConfirmationKeys,
  getAgenticMerchantSlug: mocks.getAgenticMerchantSlug,
  getAgenticSigningKeys: mocks.getAgenticSigningKeys,
}));

vi.mock('@/lib/agentic/jwt-signing-material', () => ({
  hasUsableAgenticJwtSigningMaterial: mocks.hasUsableAgenticJwtSigningMaterial,
}));

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
}

function stubCompleteAgenticRuntimeEnv() {
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
  vi.stubEnv('OPENAI_AGENTIC_API_KEY', 'agent-api-key');
  vi.stubEnv('OPENAI_AGENTIC_CONFIRMATION_KEY', 'confirmation-key');
  vi.stubEnv('OPENAI_AGENTIC_SIGNING_KEY', 'signing-key');
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
  vi.stubEnv('SUPABASE_AGENTIC_JWT_PRIVATE_JWK', 'valid-agentic-private-jwk');
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('isAgenticCheckoutRuntimeConfigured', () => {
  it('requires all runtime checkout secrets before advertising checkout', () => {
    stubBaseEnv();
    stubCompleteAgenticRuntimeEnv();

    expect(isAgenticCheckoutRuntimeConfigured()).toBe(true);
  });

  it('accepts Baci-owned runtime secrets without OpenAI-named aliases', () => {
    stubBaseEnv();
    vi.stubEnv('BACI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    vi.stubEnv('BACI_AGENTIC_ACCESS_TOKEN', 'agent-api-key');
    vi.stubEnv('BACI_AGENTIC_CONFIRMATION_KEY', 'confirmation-key');
    vi.stubEnv('BACI_AGENTIC_SIGNING_KEY', 'signing-key');
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'paystack-secret');
    vi.stubEnv('SUPABASE_AGENTIC_JWT_PRIVATE_JWK', 'valid-agentic-private-jwk');

    expect(isAgenticCheckoutRuntimeConfigured()).toBe(true);
  });

  it.each([
    'OPENAI_AGENTIC_MERCHANT_SLUG',
    'OPENAI_AGENTIC_API_KEY',
    'OPENAI_AGENTIC_CONFIRMATION_KEY',
    'OPENAI_AGENTIC_SIGNING_KEY',
    'SUPABASE_AGENTIC_JWT_PRIVATE_JWK',
  ])('does not advertise checkout when %s is missing', (envKey) => {
    stubBaseEnv();
    stubCompleteAgenticRuntimeEnv();
    vi.stubEnv(envKey, '');

    expect(isAgenticCheckoutRuntimeConfigured()).toBe(false);
  });

  it('does not require Paystack configuration for the common agentic runtime', () => {
    stubBaseEnv();
    stubCompleteAgenticRuntimeEnv();
    vi.stubEnv('PAYSTACK_SECRET_KEY', '');

    expect(isAgenticCheckoutRuntimeConfigured()).toBe(true);
  });

  it('advertises checkout when an invalid configured JWK can fall back to the legacy JWT secret', () => {
    stubBaseEnv();
    stubCompleteAgenticRuntimeEnv();
    vi.stubEnv(
      'SUPABASE_AGENTIC_JWT_PRIVATE_JWK',
      'invalid-agentic-private-jwk'
    );
    vi.stubEnv('SUPABASE_JWT_SECRET', 'legacy-secret');

    expect(isAgenticCheckoutRuntimeConfigured()).toBe(true);
  });

  it('does not advertise checkout when the configured JWK cannot be imported and no legacy JWT secret exists', () => {
    stubBaseEnv();
    stubCompleteAgenticRuntimeEnv();
    vi.stubEnv(
      'SUPABASE_AGENTIC_JWT_PRIVATE_JWK',
      'invalid-agentic-private-jwk'
    );
    delete process.env.SUPABASE_JWT_SECRET;

    expect(isAgenticCheckoutRuntimeConfigured()).toBe(false);
  });
});

describe('resolveAgenticMerchantContextFromRpc', () => {
  it('maps the scoped RPC projection to the merchant context', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    const rpc = mocks.contextRpc;
    rpc.mockResolvedValueOnce({
      data: [
        {
          id: 'merchant-1',
          slug: 'fixture-store',
          business_name: 'Fixture Store',
          paystack_subaccount_code: 'ACCT_fixture',
          custom_domain: 'fixture.example.com',
          agentic_checkout_enabled: true,
          pay_on_delivery_enabled: true,
          agent_allowlist: ['fixture-agent'],
          agent_denylist: [],
        },
      ],
      error: null,
    });
    const context = await resolveAgenticMerchantContextFromRpc();
    expect(rpc).toHaveBeenCalledWith('resolve_agentic_merchant_context', {
      p_slug: 'demo-store',
    });
    expect(context).toMatchObject({
      id: 'merchant-1',
      slug: 'fixture-store',
      business_name: 'Fixture Store',
      paystack_subaccount_code: 'ACCT_fixture',
      custom_domain: 'fixture.example.com',
      agentic_checkout_enabled: true,
      pay_on_delivery_enabled: true,
      agent_user_agent_allowlist: ['fixture-agent'],
    });
  });

  it('returns null when the RPC errors or resolves no merchant', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'down' },
    });
    await expect(resolveAgenticMerchantContextFromRpc()).resolves.toBeNull();
    mocks.contextRpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(resolveAgenticMerchantContextFromRpc()).resolves.toBeNull();
  });
});

it('uses a server-scoped context client by default', async () => {
  stubBaseEnv();
  vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
  await resolveAgenticMerchantContextFromRpc();
  expect(mocks.contextClient).toHaveBeenCalledWith('demo-store');
  expect(mocks.contextRpc).toHaveBeenCalledWith(
    'resolve_agentic_merchant_context',
    { p_slug: 'demo-store' }
  );
});

it('uses one normalized slug for both scoped authority and RPC arguments', async () => {
  mocks.getAgenticMerchantSlug.mockReturnValueOnce('\t Demo-Store\n');
  mocks.contextRpc.mockResolvedValueOnce({ data: [], error: null });
  await resolveAgenticMerchantContextFromRpc();
  expect(mocks.contextClient).toHaveBeenCalledWith('demo-store');
  expect(mocks.contextRpc).toHaveBeenCalledWith(
    'resolve_agentic_merchant_context',
    { p_slug: 'demo-store' }
  );
});
