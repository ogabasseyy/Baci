import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { quoteBankCardOffer } from './bank-card-offer-quote';
import { createBankCardOfferCheckout } from './create-bank-card-offer-checkout';
import { hashBankCardOfferFilter } from './hash-bank-card-offer-filter';
import { initializeBankCardOfferPaystack } from './initialize-bank-card-offer-paystack';
import { verifyBankCardOfferPaystack } from './verify-bank-card-offer-paystack';

const { initialize, verify } = vi.hoisted(() => ({
  initialize: vi.fn(),
  verify: vi.fn(),
}));
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: initialize,
  verifyTransaction: verify,
}));

const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const userId = 'dd4c43d6-f198-4f4a-a170-ea0fae4c16c0';
const productId = '821516a6-f4b4-427e-83fb-757ed7658082';
const itemId = '9ef81bf8-5c0f-49a3-b66c-564701b50aef';
const email = 'buyer@example.test';
const reference = 'BCO-checkout-001';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('bank card offer checkout and mocked Paystack flow', () => {
  it.each([
    ['035', 'Wema Bank', 'Sterling Bank'],
    ['232', 'Sterling Bank', 'Wema Bank'],
  ] as const)('carries bank %s from the order into authorization and verification', async (bankCode, issuerName, otherIssuerName) => {
    vi.stubEnv('QUIZ_RPC_SERVER_SECRET', 'synthetic-bank-offer-test-secret');
    const quote = quoteBankCardOffer({
      merchantId,
      offer: {
        id: 'black-friday',
        merchantId,
        bankCode,
        displayName: issuerName,
        verifiedIssuerName: issuerName,
        cardBrands: ['visa', 'mastercard'],
        eligibleProductIds: [productId],
        discountBasisPoints: 500,
        maximumDiscountKobo: 2000,
        startsAt: '2026-11-27T00:00:00+01:00',
        endsAt: '2026-11-28T00:00:00+01:00',
        approvedTermsReference: 'synthetic-test-approval',
        enabled: true,
      },
      items: [{ itemId: '1', productId, unitPriceKobo: 10_000, quantity: 2 }],
      now: Date.parse('2026-11-27T12:00:00+01:00'),
    });
    if (!quote) throw new Error('Expected a quote');
    const persistedQuote = {
      ...quote,
      allocations: quote.allocations.map((allocation) => ({
        ...allocation,
        itemId,
      })),
    };
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { id: 'order-1', total: 195 }, error: null });
    await expect(
      createBankCardOfferCheckout({
        client: { rpc } as Pick<SupabaseClient, 'rpc'>,
        orderArgs: {
          p_merchant_id: merchantId,
          p_customer_email: email,
          p_user_id: userId,
        },
        quote,
        userId,
      })
    ).resolves.toMatchObject({ data: { total: 195 } });
    expect(rpc).toHaveBeenCalledWith(
      'create_storefront_bank_card_offer_order',
      {
        p_order: {
          merchant_id: merchantId,
          customer_email: email,
          user_id: userId,
        },
        p_quote: quote,
        p_route_proof: expect.objectContaining({
          action: 'storefront_bank_card_offer_order_create',
          user_id: userId,
          subject_id: merchantId,
          payload: expect.objectContaining({ quote }),
        }),
      }
    );
    const attempt = {
      quote: persistedQuote,
      acceptedFilterPolicyHash: hashBankCardOfferFilter(
        persistedQuote.paymentPolicy
      ),
      amountKobo: 19_500,
      adjustmentsKobo: 500,
      currency: 'NGN' as const,
      customerEmail: email,
      domain: 'test' as const,
      reference,
    };
    initialize.mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/example',
      reference,
    });
    const request = {
      attempt,
      callbackUrl: 'https://ogabassey.example.test/orders',
      subaccount: 'ACCT_test',
      transactionChargeKobo: 100,
    };
    await expect(
      initializeBankCardOfferPaystack({
        ...request,
        attempt: { ...attempt, amountKobo: 20_000 },
      })
    ).rejects.toThrow('payable amount');
    expect(initialize).not.toHaveBeenCalled();
    await expect(initializeBankCardOfferPaystack(request)).resolves.toBe(
      'https://checkout.paystack.com/example'
    );
    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 19_500,
        reference,
        email,
        channels: ['card'],
        metadata: {
          partnership: 'black-friday',
          custom_filters: {
            banks: [bankCode],
            card_brands: ['mastercard', 'visa'],
          },
        },
      })
    );
    const data = {
      amount: 19_500,
      currency: 'NGN',
      customer: { email },
      domain: 'test',
      reference,
      channel: 'card',
      authorization: { bank: issuerName, brand: 'visa', channel: 'card' },
      id: '9007199254740993',
      status: 'success',
      paid_at: '2026-11-27T12:02:00Z',
    };
    verify.mockResolvedValueOnce({
      success: true,
      data: {
        ...data,
        authorization: { ...data.authorization, bank: otherIssuerName },
      },
    });
    await expect(verifyBankCardOfferPaystack(attempt)).resolves.toEqual({
      kind: 'mismatch',
    });
    verify.mockResolvedValueOnce({ success: true, data });
    const verified = await verifyBankCardOfferPaystack(attempt);
    const evidence = verified?.kind === 'verified' ? verified.evidence : null;
    expect(evidence).toMatchObject({
      issuerName,
      providerVerificationId: data.id,
      amountKobo: 19_500,
      reference,
    });
  });
});
