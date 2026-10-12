import { describe, expect, it, vi } from 'vitest';
import { collectFirstCardOwnerProof } from './collect';

const intent = {
  deployment: 'staging' as const,
  integrationId: '10000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000002',
  treasuryBindingId: '10000000-0000-4000-8000-000000000003',
  businessId: 'business',
  systemIdentifier: '7685292944002592802',
  expiresAt: '2026-10-06T15:59:10Z' as const,
  intentId: '10000000-0000-4000-8000-000000000004',
  customerId: '10000000-0000-4000-8000-000000000005',
  actorId: '10000000-0000-4000-8000-000000000006',
  goalId: '10000000-0000-4000-8000-000000000007',
  email: 'fixture@example.com',
  amountKobo: 10000,
  currency: 'NGN' as const,
  reference: 'pvb-first-10000000-0000-4000-8000-000000000004',
  requestFingerprint: 'a'.repeat(64),
  idempotencyKey: '10000000-0000-4000-8000-000000000008',
  consent: {
    version: 'prefunded-first-card-v1' as const,
    oneTimeCharge: true as const,
    saveCard: true as const,
  },
};
const settings = {
  deployment: intent.deployment,
  integrationId: intent.integrationId,
  merchantId: intent.merchantId,
  treasuryBindingId: intent.treasuryBindingId,
  businessId: intent.businessId,
  systemIdentifier: intent.systemIdentifier,
  expiresAt: intent.expiresAt,
  paystackSecret: 'sk_test_fixture',
  callbackUrl: 'https://staging.ogabassey.com/savings/card-return',
};
const timestamp = Date.parse('2026-10-02T13:00:00Z');

function response(status = 'success', amount = intent.amountKobo) {
  return new Response(
    JSON.stringify({
      status: true,
      data: {
        id: 1234,
        domain: 'test',
        status,
        amount,
        currency: 'NGN',
        reference: intent.reference,
        channel: 'card',
        customer: { email: intent.email, customer_code: 'CUS_fixture' },
        metadata: {
          transaction_type: 'prefunded_first_card',
          intent_id: intent.intentId,
          customer_id: intent.customerId,
          merchant_id: intent.merchantId,
          integration_id: intent.integrationId,
          goal_id: intent.goalId,
          request_fingerprint: intent.requestFingerprint,
        },
        authorization: {
          channel: 'card',
          reusable: true,
          authorization_code: 'AUTH_fixture',
          signature: 'SIG_fixture',
          brand: 'visa',
          last4: '1234',
          exp_month: '12',
          exp_year: '2030',
        },
      },
    })
  );
}

describe('explicit owner payment verification', () => {
  it('verifies only the existing reference without starting a new payment', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response());
    const proof = await collectFirstCardOwnerProof({
      settings,
      intent,
      expectedIntent: intent,
      fetchImplementation,
      now: () => timestamp,
    });
    expect(proof.collection.amountKobo).toBe(10000);
    expect(proof.newPaymentStarted).toBe(false);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0][0]).toBe(
      `https://api.paystack.co/transaction/verify/${intent.reference}`
    );
    expect(fetchImplementation.mock.calls[0][1]?.method).toBe('GET');
  });

  it.each([
    'pending',
    'failed',
    'reversed',
    'abandoned',
  ])('refuses %s without returning a proof', async (status) => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(status));
    await expect(
      collectFirstCardOwnerProof({
        settings,
        intent,
        expectedIntent: intent,
        fetchImplementation,
        now: () => timestamp,
      })
    ).rejects.toThrow('Owner payment verification unavailable');
  });

  it('refuses mismatched provider amounts', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response('success', 10001));
    await expect(
      collectFirstCardOwnerProof({
        settings,
        intent,
        expectedIntent: intent,
        fetchImplementation,
        now: () => timestamp,
      })
    ).rejects.toThrow('Owner payment verification unavailable');
  });

  it.each([
    'goalId',
    'amountKobo',
    'requestFingerprint',
  ] as const)('refuses changed %s before provider contact', async (field) => {
    const fetchImplementation = vi.fn<typeof fetch>();
    const changed = {
      ...intent,
      [field]:
        field === 'amountKobo'
          ? 9999
          : field === 'goalId'
            ? '10000000-0000-4000-8000-000000000008'
            : 'b'.repeat(64),
    };
    await expect(
      collectFirstCardOwnerProof({
        settings,
        intent: changed,
        expectedIntent: intent,
        fetchImplementation,
        now: () => timestamp,
      })
    ).rejects.toThrow('Owner payment intent differs');
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it('refuses evidence when its independent request takes too long', async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response());
    let calls = 0;
    await expect(
      collectFirstCardOwnerProof({
        settings,
        intent,
        expectedIntent: intent,
        fetchImplementation,
        now: () => timestamp + (calls++ > 1 ? 10001 : 0),
      })
    ).rejects.toThrow('Owner payment verification unavailable');
  });
});
