import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processNextRedvaultRefund } from '@/lib/payments/redvault-refund-orchestrator';
import { createRedvaultPaystackRefundProvider } from '@/lib/payments/redvault-refund-paystack-provider';
import type { RedvaultRefund } from '@/lib/payments/redvault-refund-store';
import { quoteBankCardOffer } from './bank-card-offer-quote';
import { calculateBankCardOfferMerchandiseRefund } from './calculate-bank-card-offer-merchandise-refund';
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
  ] as const)('carries bank %s from the order into authorization, verification, and a refund', async (bankCode, issuerName, otherIssuerName) => {
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
    await expect(verifyBankCardOfferPaystack(attempt)).resolves.toBeNull();
    verify.mockResolvedValueOnce({ success: true, data });
    const evidence = (await verifyBankCardOfferPaystack(attempt))?.evidence;
    expect(evidence).toMatchObject({
      issuerName,
      providerVerificationId: data.id,
      amountKobo: 19_500,
      reference,
    });
    if (!evidence) throw new Error('Expected verified provider evidence');

    const { refundKobo } = calculateBankCardOfferMerchandiseRefund({
      quote: persistedQuote,
      itemId,
      returnedUnitIndexes: [0],
    });
    const refund: RedvaultRefund = {
      id: 'refund-1',
      amountKobo: refundKobo,
      attemptReference: evidence.reference,
      providerReference: null,
      providerStatus: null,
      state: 'processing',
      submittedAt: null,
    };
    const fetcher = vi.fn().mockResolvedValue(
      Response.json({
        status: true,
        data: {
          id: 44,
          transaction: reference,
          currency: 'NGN',
          amount: 9500,
          status: 'processed',
        },
      })
    );
    const store = {
      claimNext: vi
        .fn()
        .mockResolvedValueOnce(refund)
        .mockResolvedValueOnce(null),
      recordProviderSubmission: vi.fn().mockResolvedValue(refund),
      markSubmissionIndeterminate: vi.fn(),
      finish: vi.fn().mockResolvedValue({ ...refund, state: 'processed' }),
    };
    const provider = createRedvaultPaystackRefundProvider({
      fetcher,
      getSecret: () => 'sk_test_synthetic',
    });
    await expect(
      processNextRedvaultRefund({ provider, store })
    ).resolves.toMatchObject({ kind: 'processed' });
    await expect(
      processNextRedvaultRefund({ provider, store })
    ).resolves.toEqual({ kind: 'idle' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.paystack.co/refund',
      expect.objectContaining({
        body: JSON.stringify({
          transaction: reference,
          amount: 9500,
          currency: 'NGN',
          merchant_note: 'refund-1',
        }),
      })
    );
  });
});
