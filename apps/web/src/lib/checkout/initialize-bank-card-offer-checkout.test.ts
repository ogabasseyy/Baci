import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCachedMerchantByDomain } from '@/lib/cached-data';
import { bankCardOfferContextFixture } from '@/schemas/bank-card-offer-payment-context.test-support';
import { initializeBankCardOfferCheckout } from './initialize-bank-card-offer-checkout';
import { initializeBankCardOfferPaystack } from './initialize-bank-card-offer-paystack';

vi.mock('@/lib/cached-data', () => ({ getCachedMerchantByDomain: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('./initialize-bank-card-offer-paystack', () => ({
  initializeBankCardOfferPaystack: vi.fn(),
}));
vi.mock('@/lib/paystack', () => ({
  calculatePlatformFee: () => ({ platformFee: 200 }),
}));
vi.mock('@/lib/payments/resolve-paystack-split-transaction-charge', () => ({
  resolvePaystackSplitTransactionCharge: async () => ({
    retainedShippingKobo: 100,
    transactionChargeKobo: 300,
  }),
}));

const reference = `BCO-${'a'.repeat(32)}`;
const checkoutUrl = 'https://checkout.paystack.com/trx/campaign';
const context = {
  ...bankCardOfferContextFixture,
  slug: 'ogabassey',
  subaccount: 'ACCT_example',
};
const claim = { claimed: true, checkoutUrl: null, reference };
const unavailable = { data: null, error: { message: 'Unavailable' } };
const paystack = vi.mocked(initializeBankCardOfferPaystack);

function setup() {
  const getContext = vi.fn().mockResolvedValue({ data: context, error: null });
  const reserve = vi.fn().mockResolvedValue({ data: claim, error: null });
  const save = vi.fn().mockResolvedValue({ data: true, error: null });
  const review = vi.fn().mockResolvedValue({ data: true, error: null });
  const handlers = {
    get_bank_card_offer_checkout_context: getContext,
    claim_bank_card_offer_attempt: reserve,
    record_bank_card_offer_checkout_url: save,
    request_bank_card_offer_initialization_review: review,
  };
  const rpc = vi.fn((name: keyof typeof handlers, args: unknown) => {
    return handlers[name](args);
  });
  const input = {
    client: { rpc } as unknown as Parameters<
      typeof initializeBankCardOfferCheckout
    >[0]['client'],
    merchantId: context.quote.merchantId,
    orderId: 'order-1',
    email: ' Customer@Example.Test ',
    currency: 'NGN',
  };

  return { getContext, input, reserve, review, rpc, save };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_fake');
  vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'example.test');
  paystack.mockResolvedValue(checkoutUrl);
});
afterEach(() => vi.unstubAllEnvs());

describe('initializeBankCardOfferCheckout', () => {
  it.each([
    undefined,
    'USD',
  ])('requires NGN before reading the checkout context (%s)', async (currency) => {
    const { getContext, input, reserve } = setup();

    await expect(
      initializeBankCardOfferCheckout({ ...input, currency })
    ).resolves.toEqual({ kind: 'unavailable' });
    expect(getContext).not.toHaveBeenCalled();
    expect(reserve).not.toHaveBeenCalled();
  });

  it.each([
    'context RPC error',
    'bad context',
    'wrong merchant',
    'wrong email',
  ])('stops before reserving a reference for %s', async (failure) => {
    const { getContext, input, reserve } = setup();
    if (failure === 'context RPC error') {
      getContext.mockResolvedValueOnce(unavailable);
    } else if (failure === 'bad context') {
      getContext.mockResolvedValueOnce({ data: {}, error: null });
    } else if (failure === 'wrong merchant') {
      input.merchantId = 'another-merchant';
    } else {
      input.email = 'someone-else@example.test';
    }

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(reserve).not.toHaveBeenCalled();
    expect(paystack).not.toHaveBeenCalled();
  });

  it.each([
    unavailable,
    { data: { ...claim, reference: 'bad' }, error: null },
  ])('stops before contacting Paystack when the attempt cannot be claimed', async (response) => {
    const { input, reserve } = setup();
    reserve.mockResolvedValueOnce(response);

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(paystack).not.toHaveBeenCalled();
  });

  it('returns retirement without opening a provider checkout or review', async () => {
    const { input, reserve, review } = setup();
    reserve.mockResolvedValueOnce({ data: { retired: true }, error: null });

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'retired',
    });
    expect(paystack).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('accepts a saved customer email with different casing', async () => {
    const { getContext, input } = setup();
    getContext.mockResolvedValueOnce({
      data: { ...context, customerEmail: 'CUSTOMER@example.test' },
      error: null,
    });

    await expect(initializeBankCardOfferCheckout(input)).resolves.toMatchObject(
      {
        kind: 'initialized',
        reference,
      }
    );
  });

  it('retries a callback lookup outage before claiming a Paystack attempt', async () => {
    const { input, reserve } = setup();
    vi.mocked(getCachedMerchantByDomain).mockRejectedValueOnce(
      new Error('lookup unavailable')
    );

    await expect(
      initializeBankCardOfferCheckout({
        ...input,
        request: new Request(
          'https://merchant.example/api/payments/initialize'
        ),
      })
    ).resolves.toEqual({ kind: 'retryable', reference: undefined });
    expect(reserve).not.toHaveBeenCalled();
    expect(paystack).not.toHaveBeenCalled();
  });

  it('replays the saved URL for an existing attempt', async () => {
    const { input, reserve, review, save } = setup();
    reserve.mockResolvedValueOnce({
      data: { claimed: false, checkoutUrl, reference },
      error: null,
    });

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'initialized',
      checkoutUrl,
      reference,
    });
    expect(paystack).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(review).not.toHaveBeenCalled();
  });

  it('requests deferred reconciliation for an existing attempt without a URL', async () => {
    const { input, reserve, review } = setup();
    reserve.mockResolvedValueOnce({
      data: { ...claim, claimed: false },
      error: null,
    });

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'pending',
      reference,
    });
    expect(review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ p_failed: false, p_reference: reference })
    );
    expect(paystack).not.toHaveBeenCalled();
  });

  it('returns retryable for a young attempt with no durable review', async () => {
    const { input, reserve, review } = setup();
    reserve.mockResolvedValueOnce({ data: { ...claim, claimed: false } });
    review.mockResolvedValueOnce({ data: false, error: null });

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'retryable',
      reference,
    });
    expect(paystack).not.toHaveBeenCalled();
  });

  it('retries saving the URL against the same reference after a transient failure', async () => {
    const { input, reserve, review, save } = setup();
    save.mockRejectedValueOnce(new Error('Connection reset'));

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'initialized',
      reference,
      checkoutUrl,
    });
    expect(reserve).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ p_amount_kobo: 9500, p_domain: 'test' })
    );
    expect(paystack).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        attempt: expect.objectContaining({ reference }),
        callbackUrl: `https://ogabassey.example.test/checkout/success?reference=${reference}`,
        transactionChargeKobo: 300,
      })
    );
    expect(save.mock.calls).toEqual([
      [
        {
          p_order_id: input.orderId,
          p_merchant_id: input.merchantId,
          p_reference: reference,
          p_checkout_url: checkoutUrl,
        },
      ],
      [save.mock.calls[0]?.[0]],
    ]);
    expect(review).not.toHaveBeenCalled();
  });

  it.each([
    {
      outcome: 'the write is rejected',
      response: { data: false, error: null },
      calls: 1,
    },
    { outcome: 'both writes are unavailable', response: unavailable, calls: 2 },
  ])('requests immediate reconciliation when $outcome', async ({
    response,
    calls,
  }) => {
    const { input, review, save } = setup();
    save.mockResolvedValue(response);

    await expect(initializeBankCardOfferCheckout(input)).resolves.toEqual({
      kind: 'pending',
      reference,
    });
    expect(save).toHaveBeenCalledTimes(calls);
    expect(paystack).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ p_failed: true, p_reference: reference })
    );
  });

  it('surfaces a reconciliation write failure after a Paystack error', async () => {
    const { input, review, save } = setup();
    paystack.mockRejectedValueOnce(new Error('Paystack timeout'));
    review.mockResolvedValueOnce(unavailable);

    await expect(initializeBankCardOfferCheckout(input)).rejects.toThrow(
      'Unable to record bank offer initialization review'
    );
    expect(save).not.toHaveBeenCalled();
    expect(paystack).toHaveBeenCalledTimes(1);
    expect(review).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ p_failed: true, p_reference: reference })
    );
  });
});
