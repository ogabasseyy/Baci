import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createScopedClient: vi.fn(),
  signScopedSupabaseJwt: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mocks.createScopedClient,
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mocks.signScopedSupabaseJwt,
}));

import { createRedvaultPaymentAttemptClient } from './redvault-payment-attempt-client';

describe('createRedvaultPaymentAttemptClient', () => {
  it('rejects another merchant before minting a JWT or using a fallback', () => {
    vi.clearAllMocks();
    const rpc = vi.fn();
    expect(() =>
      createRedvaultPaymentAttemptClient({
        customerEmail: 'customer@example.test',
        fallbackClient: { rpc } as never,
        merchantId: '11111111-1111-4111-8111-111111111111',
        userId: null,
      })
    ).toThrow('REDVAULT is exclusive to Ogabassey');
    expect(mocks.signScopedSupabaseJwt).not.toHaveBeenCalled();
    expect(mocks.createScopedClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('reserves and persists attempts with a customer-scoped JWT', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            amount_kobo: 95000,
            attempt_id: 'attempt-1',
            authorization_url: null,
            bank_code: '033',
            reference: 'RV-reference-1',
            state: 'created',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            amount_kobo: 95000,
            attempt_id: 'attempt-1',
            authorization_url: null,
            bank_code: '033',
            initialization_claimed: true,
            reference: 'RV-reference-1',
            state: 'initializing',
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            amount_kobo: 95000,
            attempt_id: 'attempt-1',
            authorization_url: 'https://paystack.test/checkout/1',
            bank_code: '033',
            reference: 'RV-reference-1',
            state: 'initialized',
          },
        ],
        error: null,
      });
    mocks.signScopedSupabaseJwt.mockReturnValue('scoped-token');
    mocks.createScopedClient.mockReturnValue({ rpc });

    const adapter = createRedvaultPaymentAttemptClient({
      customerEmail: ' Customer@Example.test ',
      fallbackClient: { rpc: vi.fn() } as never,
      merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
      userId: 'customer-id',
    });

    await expect(adapter.reserve('order-1')).resolves.toMatchObject({
      amountKobo: 95000,
      state: 'created',
    });
    await expect(
      adapter.claimInitialization('attempt-1')
    ).resolves.toMatchObject({
      claimed: true,
      attempt: { state: 'initializing' },
    });
    await expect(
      adapter.markInitialized('attempt-1', 'https://paystack.test/checkout/1')
    ).resolves.toMatchObject({
      authorizationUrl: 'https://paystack.test/checkout/1',
    });
    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'authenticated',
        storefront_order_context: 'route',
        storefront_order_merchant_id: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
        storefront_redvault_customer_email: 'customer@example.test',
        sub: 'customer-id',
      })
    );
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      'reserve_storefront_redvault_payment_attempt',
      { p_order_id: 'order-1' }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'claim_storefront_redvault_payment_attempt_initialization',
      { p_attempt_id: 'attempt-1' }
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      'record_storefront_redvault_payment_attempt_initialization',
      {
        p_attempt_id: 'attempt-1',
        p_authorization_url: 'https://paystack.test/checkout/1',
        p_state: 'initialized',
      }
    );
  });
});
