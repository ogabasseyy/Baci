import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardCheckoutProvider } from './prefunded-card-checkout-provider';

const intent = {
  deployment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  treasuryBindingId: '10000000-0000-4000-8000-000000000003',
  businessId: 'business_staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-09-29T15:59:10Z',
  intentId: '10000000-0000-4000-8000-000000000004',
  customerId: '10000000-0000-4000-8000-000000000005',
  actorId: '10000000-0000-4000-8000-000000000006',
  goalId: '10000000-0000-4000-8000-000000000007',
  amountKobo: 250_000,
  idempotencyKey: '10000000-0000-4000-8000-000000000008',
  consent: {
    version: 'prefunded-first-card-v1',
    oneTimeCharge: true,
    saveCard: true,
  },
  email: 'customer@example.test',
  currency: 'NGN',
  reference: 'pvb-first-10000000-0000-4000-8000-000000000004',
  requestFingerprint: 'a'.repeat(64),
};

const settings = {
  deployment: 'staging',
  integrationId: intent.integrationId,
  merchantId: intent.merchantId,
  treasuryBindingId: intent.treasuryBindingId,
  businessId: intent.businessId,
  systemIdentifier: intent.systemIdentifier,
  expiresAt: intent.expiresAt,
  paystackSecret: 'sk_test_checkoutsecret',
  callbackUrl: 'https://staging.ogabassey.com/savings/card-return',
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeProvider(
  fetchImplementation: typeof fetch,
  now = Date.parse('2026-09-26T12:00:00Z'),
  providerSettings = settings
) {
  return createPrefundedCardCheckoutProvider({
    settings: providerSettings,
    fetchImplementation,
    now: () => now,
  });
}

function verifiedResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: true,
    data: {
      id: '18446744073709551615',
      domain: 'test',
      status: 'success',
      reference: intent.reference,
      amount: intent.amountKobo,
      currency: 'NGN',
      channel: 'card',
      metadata: {
        transaction_type: 'prefunded_first_card',
        intent_id: intent.intentId,
        customer_id: intent.customerId,
        merchant_id: intent.merchantId,
        integration_id: intent.integrationId,
        goal_id: intent.goalId,
        request_fingerprint: intent.requestFingerprint,
      },
      customer: { email: intent.email, customer_code: 'CUS_test_1' },
      authorization: {
        authorization_code: 'AUTH_test_1',
        signature: 'sig_test_1',
        channel: 'card',
        reusable: true,
        brand: 'Visa',
        last4: '4242',
        exp_month: '08',
        exp_year: '2030',
      },
      ...overrides,
    },
  };
}

describe('prefunded first-card Paystack adapter', () => {
  it('initializes card-only collection with the exact intent-bound request and returns a minimal session', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: true,
        data: {
          reference: intent.reference,
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'abc123',
        },
      })
    );
    const provider = makeProvider(fetchImplementation);

    await expect(provider.initialize(intent)).resolves.toEqual({
      reference: intent.reference,
      authorizationUrl: 'https://checkout.paystack.com/abc123',
    });
    const [url, request] = fetchImplementation.mock.calls[0];
    expect(url).toBe('https://api.paystack.co/transaction/initialize');
    expect(JSON.parse(String(request?.body))).toEqual({
      amount: '250000',
      email: intent.email,
      currency: 'NGN',
      reference: intent.reference,
      channels: ['card'],
      callback_url: settings.callbackUrl,
      metadata: {
        transaction_type: 'prefunded_first_card',
        intent_id: intent.intentId,
        customer_id: intent.customerId,
        merchant_id: intent.merchantId,
        integration_id: intent.integrationId,
        goal_id: intent.goalId,
        request_fingerprint: intent.requestFingerprint,
      },
    });
    expect(String(request?.body)).not.toContain('authorization_code');
    expect(request?.redirect).toBe('error');
  });

  it('accepts the approved October lease only when intent and provider settings agree', async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: true,
        data: {
          reference: intent.reference,
          authorization_url: 'https://checkout.paystack.com/abc123',
          access_code: 'abc123',
        },
      })
    );
    const expiresAt = '2026-10-06T15:59:10Z';
    const renewedIntent = { ...intent, expiresAt };
    const provider = makeProvider(
      fetchImplementation,
      Date.parse('2026-10-06T15:59:09Z'),
      { ...settings, expiresAt }
    );
    await expect(provider.initialize(renewedIntent)).resolves.toMatchObject({
      reference: renewedIntent.reference,
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();

    await expect(
      makeProvider(fetchImplementation, Date.now(), settings).initialize(
        renewedIntent
      )
    ).rejects.toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
  });

  it('refuses invalid keys, intent scope, references, and expired intents before fetch', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    expect(() =>
      createPrefundedCardCheckoutProvider({
        settings: { ...settings, paystackSecret: 'sk_live_secret' },
        fetchImplementation,
      })
    ).toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
    const provider = makeProvider(fetchImplementation);
    await expect(
      provider.initialize({ ...intent, merchantId: settings.integrationId })
    ).rejects.toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
    await expect(
      provider.initialize({ ...intent, reference: 'caller-reference' })
    ).rejects.toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
    await expect(
      makeProvider(fetchImplementation, Date.parse(intent.expiresAt)).verify(
        intent
      )
    ).rejects.toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
    await expect(
      makeProvider(fetchImplementation, Number.NaN).initialize(intent)
    ).rejects.toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it.each([
    ['a non-Paystack checkout URL', 'https://evil.example/abc123', 'abc123'],
    [
      'an access code that differs from the URL',
      'https://checkout.paystack.com/abc123',
      'other',
    ],
  ])('rejects %s and exposes no provider response data', async (_label, authorizationUrl, accessCode) => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        status: true,
        data: {
          reference: intent.reference,
          authorization_url: authorizationUrl,
          access_code: accessCode,
        },
      })
    );
    await expect(
      makeProvider(fetchImplementation).initialize(intent)
    ).rejects.toThrow('PREFUNDED_CARD_PROVIDER_UNAVAILABLE');
  });

  it('returns only verified reusable card evidence after matching all identity pins', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(verifiedResponse()));
    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'verified',
      collection: {
        intentId: intent.intentId,
        reference: intent.reference,
        providerTransactionId: '18446744073709551615',
        amountKobo: intent.amountKobo,
        currency: 'NGN',
        domain: 'test',
        authorization: {
          authorizationCode: 'AUTH_test_1',
          signature: 'sig_test_1',
          customerCode: 'CUS_test_1',
          email: intent.email,
          reusable: true,
          brand: 'Visa',
          last4: '4242',
          expiryMonth: '08',
          expiryYear: '2030',
        },
      },
    });
  });

  it('returns pending for a transient verification transport failure', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error('PROVIDER_TIMEOUT'));
    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'pending',
    });
  });

  it('requires the authorization itself to identify a card channel', async () => {
    const response = verifiedResponse();
    response.data.authorization.channel = 'bank';
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(response));
    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it.each([
    ['missing metadata', { metadata: undefined }],
    [
      'mismatched email',
      {
        customer: { email: 'other@example.test', customer_code: 'CUS_test_1' },
      },
    ],
    ['mismatched amount', { amount: intent.amountKobo + 1 }],
    ['non-reusable authorization', { authorization: { reusable: false } }],
    ['unsafe numeric transaction id', { id: Number.MAX_SAFE_INTEGER + 1 }],
    ['out-of-range transaction id', { id: '18446744073709551616' }],
  ])('requires reconciliation for %s', async (_label, override) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(verifiedResponse(override)));
    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it('returns pending only for an identity-matched nonterminal transaction', async () => {
    const result = verifiedResponse({ status: 'processing' });
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(result));
    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'pending',
    });
  });
});
