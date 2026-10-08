import { describe, expect, it, vi } from 'vitest';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { createPrimaryWalletCardCheckoutProvider } from './primary-wallet-card-checkout-provider';

function response(overrides: Record<string, unknown> = {}) {
  return {
    status: true,
    data: {
      id: '12345',
      reference: fixture.intent.reference,
      amount: 25000,
      currency: 'NGN',
      domain: 'test',
      channel: 'card',
      status: 'success',
      customer: { email: fixture.intent.email, customer_code: 'CUS_fixture' },
      metadata: {
        transaction_type: 'primary_wallet_card_checkout',
        operation_id: fixture.intent.operationId,
        integration_id: fixture.intent.integrationId,
        merchant_id: fixture.intent.merchantId,
        customer_id: fixture.intent.customerId,
        user_id: fixture.intent.userId,
        environment: fixture.intent.environment,
        request_fingerprint: fixture.intent.fingerprint,
      },
      ...overrides,
    },
  };
}
function setup(
  body: unknown = response(),
  settings: unknown = fixture.settings
) {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  return {
    transport,
    provider: createPrimaryWalletCardCheckoutProvider(settings, transport),
  };
}

describe('goal-independent primary card collection', () => {
  it('verifies a one-time card charge without reusable authorization', async () => {
    const { provider } = setup();
    expect(await provider.verify(fixture.intent)).toEqual({
      outcome: 'verified',
      collection: {
        providerTransactionId: '12345',
        amountKobo: 25000,
        reference: fixture.intent.reference,
        domain: 'test',
        token: null,
      },
    });
  });
  it.each([
    false,
    true,
  ])('does not require tokenization for consent saveCard=%s', async (saveCard) => {
    const { provider } = setup(
      response({ authorization: { reusable: false, channel: 'card' } })
    );
    const result = await provider.verify({
      ...fixture.intent,
      consent: { ...fixture.intent.consent, saveCard },
    });
    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified')
      expect(result.collection.token).toBeNull();
  });
  it('retains a verified reusable token only with explicit consent', async () => {
    const { provider } = setup(
      response({
        authorization: {
          reusable: true,
          channel: 'card',
          authorization_code: 'AUTH_fixture',
        },
      })
    );
    const result = await provider.verify({
      ...fixture.intent,
      consent: { ...fixture.intent.consent, saveCard: true },
    });
    expect(result.outcome).toBe('verified');
    if (result.outcome === 'verified')
      expect(result.collection.token?.reusable).toBe(true);
    const unconsented = await provider.verify(fixture.intent);
    if (unconsented.outcome === 'verified')
      expect(unconsented.collection.token).toBeNull();
  });
  it.each([
    { amount: 24999 },
    { currency: 'USD' },
    { domain: 'live' },
    { channel: 'bank_transfer' },
    { reference: 'WAL-fixture' },
    { customer: { email: 'other@example.test' } },
    { metadata: {} },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { status: 'failed' },
  ])('rejects mismatched collection %j', async (override) => {
    expect(
      await setup(response(override)).provider.verify(fixture.intent)
    ).toEqual({ outcome: 'reconciliation_required' });
  });
  it('keeps transport uncertainty pending', async () => {
    const { provider, transport } = setup();
    transport.mockRejectedValue(new Error('fixture failure'));
    expect(await provider.verify(fixture.intent)).toEqual({
      outcome: 'pending',
    });
  });
  it('supports live verification only with production settings', async () => {
    const { provider } = setup(
      response({
        domain: 'live',
        metadata: { ...response().data.metadata, environment: 'production' },
      }),
      {
        ...fixture.settings,
        environment: 'production',
        paystackSecret: 'sk_live_fixture',
      }
    );
    expect(
      (await provider.verify({ ...fixture.intent, environment: 'production' }))
        .outcome
    ).toBe('verified');
  });
  it('initializes a card-only checkout with primary metadata and no goal', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            reference: fixture.intent.reference,
            authorization_url: 'https://checkout.paystack.com/fixture123',
            access_code: 'fixture123',
          },
        })
      )
    );
    const provider = createPrimaryWalletCardCheckoutProvider(
      fixture.settings,
      transport
    );
    expect(await provider.initialize(fixture.intent)).toEqual({
      reference: fixture.intent.reference,
      authorizationUrl: 'https://checkout.paystack.com/fixture123',
    });
    const payload = JSON.parse(String(transport.mock.calls[0]?.[1]?.body));
    expect(payload.channels).toEqual(['card']);
    expect(payload.metadata.transaction_type).toBe(
      'primary_wallet_card_checkout'
    );
    expect(payload.metadata).not.toHaveProperty('goal_id');
  });
  it('rejects expired deployment configuration before transport', async () => {
    const { provider, transport } = setup(response(), {
      ...fixture.settings,
      expiresAt: '2026-09-29T15:59:10Z',
    });
    await expect(provider.initialize(fixture.intent)).rejects.toThrow(
      'Primary card provider unavailable'
    );
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects a checkout session with a mismatched access code', async () => {
    const { provider } = setup({
      status: true,
      data: {
        reference: fixture.intent.reference,
        authorization_url: 'https://checkout.paystack.com/fixture',
        access_code: 'other',
      },
    });
    await expect(provider.initialize(fixture.intent)).rejects.toThrow(
      'Primary card provider unavailable'
    );
  });
  it('accepts provider checkout URL variants while correlating the access code', async () => {
    const { provider } = setup({
      status: true,
      data: {
        reference: fixture.intent.reference,
        authorization_url:
          'https://checkout.paystack.com/pay/fixture-123_ABC?reference=xyz',
        access_code: 'fixture-123_ABC',
      },
    });
    expect(await provider.initialize(fixture.intent)).toEqual({
      reference: fixture.intent.reference,
      authorizationUrl:
        'https://checkout.paystack.com/pay/fixture-123_ABC?reference=xyz',
    });
  });
  it('rejects lookalike checkout hosts even with a matching path', async () => {
    const { provider } = setup({
      status: true,
      data: {
        reference: fixture.intent.reference,
        authorization_url:
          'https://checkout.paystack.com.evil.example.com/fixture123',
        access_code: 'fixture123',
      },
    });
    await expect(provider.initialize(fixture.intent)).rejects.toThrow(
      'Primary card provider unavailable'
    );
  });
});
