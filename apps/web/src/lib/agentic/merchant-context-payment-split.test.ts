// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveAgenticMerchantContextFromRpc } from '@/lib/agentic/merchant-context';

// server-only has no runtime exports; mock it so Vitest can import server modules.
vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  contextRpc: vi.fn<() => Promise<{ data: unknown; error: unknown }>>(
    async () => ({ data: [], error: null })
  ),
  contextClient: vi.fn(),
  getAgenticMerchantSlug: vi.fn(() => {
    const value = process.env.OPENAI_AGENTIC_MERCHANT_SLUG;
    return typeof value === 'string' && value.trim().length > 0
      ? value
      : undefined;
  }),
}));

vi.mock('@/lib/agentic/scoped-supabase', () => ({
  createAgenticMerchantContextClient: (slug: string) => {
    mocks.contextClient(slug);
    return { rpc: mocks.contextRpc };
  },
}));

vi.mock('@/env', () => ({
  getAgenticApiKey: vi.fn(),
  getAgenticConfirmationKeys: vi.fn(() => []),
  getAgenticMerchantSlug: mocks.getAgenticMerchantSlug,
  getAgenticSigningKeys: vi.fn(() => []),
}));

function stubBaseEnv() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-key');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://supabase.example.com');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key');
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('resolveAgenticMerchantContextFromRpc payment split', () => {
  it('reads the payment split through its own scoped RPC when asked', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc
      .mockResolvedValueOnce({
        data: [
          {
            id: 'merchant-1',
            slug: 'demo-store',
            paystack_subaccount_code: null,
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ paystack_subaccount_code: 'ACCT_split' }],
        error: null,
      });

    const context = await resolveAgenticMerchantContextFromRpc({
      includePaymentSplit: true,
    });

    expect(mocks.contextRpc).toHaveBeenNthCalledWith(
      2,
      'resolve_agentic_merchant_payment_split',
      { p_slug: 'demo-store' }
    );
    expect(context).toMatchObject({
      id: 'merchant-1',
      paystack_subaccount_code: 'ACCT_split',
    });
  });

  it('does not read the payment split by default', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc.mockResolvedValueOnce({
      data: [{ id: 'merchant-1', slug: 'demo-store' }],
      error: null,
    });

    const context = await resolveAgenticMerchantContextFromRpc();

    expect(mocks.contextRpc).toHaveBeenCalledTimes(1);
    expect(context?.paystack_subaccount_code).toBeNull();
  });

  it('fails closed when the payment split RPC errors', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc
      .mockResolvedValueOnce({
        data: [{ id: 'merchant-1', slug: 'demo-store' }],
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: { message: 'down' } });

    await expect(
      resolveAgenticMerchantContextFromRpc({ includePaymentSplit: true })
    ).resolves.toBeNull();
  });

  it('keeps a missing subaccount null so completion still answers 424', async () => {
    stubBaseEnv();
    vi.stubEnv('OPENAI_AGENTIC_MERCHANT_SLUG', 'demo-store');
    mocks.contextRpc
      .mockResolvedValueOnce({
        data: [{ id: 'merchant-1', slug: 'demo-store' }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ paystack_subaccount_code: null }],
        error: null,
      });

    const context = await resolveAgenticMerchantContextFromRpc({
      includePaymentSplit: true,
    });

    expect(context).toMatchObject({
      id: 'merchant-1',
      paystack_subaccount_code: null,
    });
  });
});
