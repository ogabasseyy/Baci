import { describe, expect, it, vi } from 'vitest';
import { createPrefundedCardCheckoutProvider } from './prefunded-card-checkout-provider';

type ResponseMismatch = [string, Record<string, unknown>];

const intent = {
  deployment: 'staging',
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  treasuryBindingId: '10000000-0000-4000-8000-000000000003',
  businessId: 'business_staging',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-10-06T15:59:10Z',
  intentId: '10000000-0000-4000-8000-000000000004',
  customerId: '10000000-0000-4000-8000-000000000005',
  actorId: '10000000-0000-4000-8000-000000000006',
  goalId: '10000000-0000-4000-8000-000000000007',
  amountKobo: 10_000,
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
  deployment: intent.deployment,
  integrationId: intent.integrationId,
  merchantId: intent.merchantId,
  treasuryBindingId: intent.treasuryBindingId,
  businessId: intent.businessId,
  systemIdentifier: intent.systemIdentifier,
  expiresAt: intent.expiresAt,
  paystackSecret: 'sk_test_pendingfixture',
  callbackUrl: 'https://staging.ogabassey.com/savings/card-return',
};

const metadata = {
  transaction_type: 'prefunded_first_card',
  intent_id: intent.intentId,
  customer_id: intent.customerId,
  merchant_id: intent.merchantId,
  integration_id: intent.integrationId,
  goal_id: intent.goalId,
  request_fingerprint: intent.requestFingerprint,
};

const authorization = {
  authorization_code: 'AUTH_pendingfixture',
  signature: 'sig_pendingfixture',
  channel: 'card',
  reusable: true,
  brand: 'Visa',
  last4: '4242',
  exp_month: '08',
  exp_year: '2030',
};

function providerResponse(
  status: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    status: true,
    data: {
      id: '18446744073709551615',
      domain: 'test',
      status,
      reference: intent.reference,
      amount: intent.amountKobo,
      currency: 'NGN',
      channel: 'card',
      metadata,
      customer: { email: intent.email, customer_code: 'CUS_pendingfixture' },
      ...(status === 'success' ? { authorization } : {}),
      ...overrides,
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeProvider(
  fetchImplementation: typeof fetch,
  now = Date.parse('2026-10-02T13:03:57Z'),
  providerSettings = settings
) {
  return createPrefundedCardCheckoutProvider({
    settings: providerSettings,
    fetchImplementation,
    now: () => now,
  });
}

describe('regression: abandoned first-card checkout remains pollable', () => {
  it('returns pending without authorization then verifies the same reference without another initialization', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(providerResponse('abandoned')))
      .mockResolvedValueOnce(jsonResponse(providerResponse('success')));
    const provider = makeProvider(fetchImplementation);
    const initialize = vi.spyOn(provider, 'initialize');

    await expect(provider.verify(intent)).resolves.toEqual({
      outcome: 'pending',
    });
    await expect(provider.verify(intent)).resolves.toEqual({
      outcome: 'verified',
      collection: {
        intentId: '10000000-0000-4000-8000-000000000004',
        reference: 'pvb-first-10000000-0000-4000-8000-000000000004',
        providerTransactionId: '18446744073709551615',
        amountKobo: 10_000,
        currency: 'NGN',
        domain: 'test',
        authorization: {
          authorizationCode: 'AUTH_pendingfixture',
          signature: 'sig_pendingfixture',
          customerCode: 'CUS_pendingfixture',
          email: 'customer@example.test',
          reusable: true,
          brand: 'Visa',
          last4: '4242',
          expiryMonth: '08',
          expiryYear: '2030',
        },
      },
    });
    expect(initialize).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    for (const [url, request] of fetchImplementation.mock.calls) {
      expect(url).toBe(
        'https://api.paystack.co/transaction/verify/pvb-first-10000000-0000-4000-8000-000000000004'
      );
      expect(request?.method).toBe('GET');
      expect(request?.body).toBeUndefined();
    }
  });

  it.each<ResponseMismatch>([
    ['amount', { amount: 10_001 }],
    ['email', { customer: { email: 'other@example.test' } }],
    ['domain', { domain: 'live' }],
    ['currency', { currency: 'USD' }],
    ['reference', { reference: 'pvb-first-other' }],
    ['missing metadata', { metadata: undefined }],
    ...Object.keys(metadata).map(
      (field): ResponseMismatch => [
        `metadata ${field}`,
        { metadata: { ...metadata, [field]: 'mismatched' } },
      ]
    ),
  ])('requires reconciliation for abandoned with mismatched %s', async (_label, overrides) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(providerResponse('abandoned', overrides))
      );

    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it('requires reconciliation when abandoned verification has response.status false', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ ...providerResponse('abandoned'), status: false })
      );

    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it.each([
    'failed',
    'reversed',
    'unknown',
  ])('keeps %s in reconciliation', async (status) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(providerResponse(status)));

    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it.each<ResponseMismatch>([
    ['missing authorization', { authorization: undefined }],
    ['non-card payment', { channel: 'bank' }],
    [
      'non-card authorization',
      { authorization: { ...authorization, channel: 'bank' } },
    ],
    [
      'non-reusable authorization',
      { authorization: { ...authorization, reusable: false } },
    ],
    [
      'invalid authorization code',
      { authorization: { ...authorization, authorization_code: 'invalid' } },
    ],
    ['missing customer code', { customer: { email: intent.email } }],
    ['invalid transaction id', { id: '18446744073709551616' }],
  ])('keeps success with %s in reconciliation', async (_label, overrides) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(providerResponse('success', overrides)));

    await expect(
      makeProvider(fetchImplementation).verify(intent)
    ).resolves.toEqual({
      outcome: 'reconciliation_required',
    });
  });

  it.each([
    0, 1,
  ])('rejects polling %s milliseconds after the expiry boundary before fetch', async (offset) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = makeProvider(
      fetchImplementation,
      Date.parse(intent.expiresAt) + offset
    );

    await expect(provider.verify(intent)).rejects.toThrow(
      'PREFUNDED_CARD_PROVIDER_UNAVAILABLE'
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('rejects a differently configured lease before fetching an abandoned response', async () => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const provider = makeProvider(
      fetchImplementation,
      Date.parse('2026-09-28T12:00:00Z'),
      { ...settings, expiresAt: '2026-09-29T15:59:10Z' }
    );

    await expect(provider.verify(intent)).rejects.toThrow(
      'PREFUNDED_CARD_PROVIDER_UNAVAILABLE'
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
