import { createHmac, randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hashBankCardOfferFilter } from '@/lib/checkout/hash-bank-card-offer-filter';
import { executeOrderCancellationSideEffect } from '@/lib/orders/execute-order-cancellation-side-effect';
import { POST as initialize } from './initialize/route';
import { POST as verify } from './verify/route';
import { POST as webhook } from './webhook/route';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  initialize: vi.fn(),
  verify: vi.fn(),
  refund: vi.fn(),
  cookieAuth: vi.fn(),
  csrf: vi.fn(),
}));
const userId = 'c4c9b190-6486-418a-8f68-dce9269e0eac';
const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
const orderId = 'b32deabd-77d7-45db-b28d-ccdd58240516';
const transactionId = 'ad3c848c-da33-4405-bd41-ae00db772a0e';
const itemId = 'ef8cd4bb-010e-4ce6-ab1a-9a29ef36569f';
const productId = 'f37548d2-5d3a-41cf-8109-6a82a1684567';
const customerEmail = 'buyer@example.com';
const reference = 'BCO-1234567890abcdef1234567890abcdef';
const secret = `sk_test_${randomBytes(32).toString('hex')}`;

vi.mock('@/lib/go54', () => ({
  isGo54Configured: () => false,
  registerDomain: vi.fn(),
}));
vi.mock('@/env', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  env: {
    get PAYSTACK_SECRET_KEY() {
      return process.env.PAYSTACK_SECRET_KEY;
    },
  },
  getSupabaseUrl: () => 'https://synthetic.example.test',
  getSupabaseAnonKey: () => 'synthetic',
}));
vi.mock('next/server', async (importOriginal) => ({
  ...((await importOriginal()) as Record<string, unknown>),
  after: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: async () => ({ user: { id: userId } }),
}));
vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: mocks.cookieAuth,
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mocks.csrf,
}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => mocks }));
vi.mock('@/lib/checkout/storefront-order-rpc-client', () => ({
  createStorefrontOrderRpcClient: () => mocks,
}));
vi.mock('@/lib/paystack', () => ({
  initializeTransaction: mocks.initialize,
  verifyTransaction: mocks.verify,
  calculatePlatformFee: () => ({ platformFee: 100, merchantAmount: 9400 }),
}));
vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: mocks.refund,
}));
vi.mock('@/lib/orders/check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: async () => [],
}));
vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: async () => ({
    failedSteps: [],
    ranSteps: [],
    skippedSteps: [],
    concurrentTakeoverSteps: [],
  }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

function request(path: string, payload: Record<string, unknown>, sign = false) {
  const body = JSON.stringify(
    path === 'verify' ? { merchantSlug: merchant.slug, ...payload } : payload
  );
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (sign)
    headers['x-paystack-signature'] = createHmac(
      'sha512',
      process.env.PAYSTACK_SECRET_KEY ?? ''
    )
      .update(body)
      .digest('hex');
  return new NextRequest(`http://localhost/api/payments/${path}`, {
    method: 'POST',
    body,
    headers,
  });
}

const merchant = {
  id: merchantId,
  slug: 'ogabassey',
  business_name: 'Ogabassey',
  support_email: null,
  email: 'store@example.com',
  cac_rc_number: null,
  tax_identification_number: null,
  email_sender_name: null,
};
const order = {
  id: orderId,
  order_number: 'ORD-BANK-OFFER',
  payment_method: 'bank_card_offer',
  merchant_id: merchantId,
  amount_paid: 95,
  subtotal: 100,
  discount_amount: 5,
  total: 95,
  currency: 'NGN',
  customer_email: customerEmail,
  customer_name: 'Buyer',
  customer_id: null,
  customer_phone: null,
  gift_wrapping_fee: 0,
  shipping_fee: 0,
  tax_amount: 0,
  tax_basis: 'exclusive',
  cancelled_at: null,
  shipping_status: 'pending',
  payment_status: 'unpaid',
  order_items: [],
  shipping_address: {},
  ad_tracking: null,
  updated_at: '2026-11-27T10:00:00Z',
};

function setup(
  bankCode: '035' | '232',
  issuerName: string,
  lookup?: { data: null; error: { code: string } | null },
  saveCheckoutUrl = true,
  failFirstCompletion = false
) {
  mocks.csrf.mockResolvedValue({ valid: true });
  mocks.cookieAuth.mockResolvedValue({
    authMode: 'cookie',
    user: { id: userId },
    supabase: mocks,
  });
  let claimed = false;
  let checkoutUrl: string | null = null;
  let approved = false;
  let approvedResponse: Record<string, unknown> | null = null;
  let shouldFailCompletion = failFirstCompletion;
  let paid = false;
  let terminalReview = false;
  const refundInsert = vi.fn().mockResolvedValue({ error: null });
  const quote = {
    merchantId,
    approvedTermsReference: 'test-terms',
    endsAt: '2026-11-28T23:59:00Z',
    paymentPolicy: {
      bankCode,
      issuerName,
      partnership: 'black-friday',
      cardBrands: ['visa' as const],
    },
    productSubtotalKobo: 10_000,
    eligibleSubtotalKobo: 10_000,
    discountKobo: 500,
    allocations: [
      {
        itemId,
        productId,
        quantity: 1,
        unitPriceKobo: 10_000,
        unitNetAmountsKobo: [9500],
      },
    ],
  };
  const data = {
    id: 42,
    reference,
    amount: 9500,
    currency: 'NGN',
    domain: 'test',
    status: 'success',
    channel: 'card',
    authorization: { bank: issuerName, brand: 'visa', channel: 'card' },
    customer: { email: customerEmail },
    paid_at: '2026-11-27T10:00:00Z',
  };
  mocks.initialize.mockResolvedValue({
    reference,
    authorization_url:
      'https://checkout.paystack.com/trx/example?state=one%2Btwo&x=1',
  });
  mocks.verify.mockResolvedValue({ success: true, data });
  mocks.refund.mockResolvedValue({
    success: true,
    data: { id: 64, status: 'pending', transaction: { id: 42, reference } },
  });
  mocks.rpc.mockImplementation(async (name, args) => {
    switch (name) {
      case 'get_sessionless_payment_reference_snapshot':
        return {
          data: [
            {
              transaction_id: transactionId,
              order_id: orderId,
              merchant_id: merchantId,
              amount: 95,
              gateway_reference: reference,
              gateway: 'paystack',
            },
          ],
        };
      case 'get_bank_card_offer_checkout_context':
        return {
          data: {
            quote,
            amountKobo: 9500,
            customerEmail,
            subaccount: 'ACCT_test',
            slug: merchant.slug,
          },
        };
      case 'get_order_paystack_split_retained_shipping_kobo':
        return { data: 0 };
      case 'claim_bank_card_offer_attempt': {
        const newClaim = !claimed;
        claimed = true;
        return {
          data: {
            claimed: newClaim,
            reference,
            checkoutUrl: terminalReview ? null : checkoutUrl,
          },
        };
      }
      case 'record_bank_card_offer_checkout_url':
        if (!saveCheckoutUrl) return { data: false };
        checkoutUrl = args.p_checkout_url;
        return { data: true };
      case 'get_bank_card_offer_webhook_transaction':
        return (
          lookup ?? {
            data: {
              id: transactionId,
              merchant_id: merchantId,
              order_id: orderId,
              gateway: 'paystack',
              gateway_reference: reference,
              amount: 95,
              platform_fee: 1,
            },
            error: null,
          }
        );
      case 'get_bank_card_offer_verification_context':
        return {
          data: {
            quote,
            domain: 'test',
            reference,
            amountKobo: 9500,
            customerEmail,
            completedGatewayResponse: approvedResponse,
            acceptedFilterPolicyHash: hashBankCardOfferFilter(
              quote.paymentPolicy
            ),
          },
        };
      case 'request_bank_card_offer_initialization_review':
        return { data: true, error: null };
      case 'flag_bank_card_offer_terminal_review':
        terminalReview = true;
        return { data: true };
      case 'approve_bank_card_offer_capture':
        approved = args.p_evidence.issuerName === issuerName;
        if (approved) approvedResponse = args.p_gateway_response;
        return { data: approved };
      case 'complete_order_gateway_payment': {
        if (!approved) throw new Error('completion before issuer approval');
        if (shouldFailCompletion) {
          shouldFailCompletion = false;
          return { data: null, error: { code: '57014' } };
        }
        const replay = paid;
        paid = true;
        return {
          data: {
            actor: null,
            already_completed: replay,
            order_already_paid: replay,
            order_updated: !replay,
            order_cancelled: false,
            order_skipped_status: null,
            previous_payment_status: 'pending',
            previous_shipping_status: 'pending',
            payment_status: 'paid',
            shipping_status: 'processing',
            cancelled_at: null,
            order_number: order.order_number,
          },
        };
      }
      case 'get_bank_card_offer_refundable_amount':
        return { data: paid && args.p_reference === reference ? 9500 : null };
      default:
        return { data: null, error: null };
    }
  });
  mocks.from.mockImplementation((table) => {
    const filters: Record<string, string> = {};
    const transaction = {
      id: transactionId,
      order_id: orderId,
      merchant_id: merchantId,
      gateway: 'paystack',
      gateway_reference: reference,
      currency: 'NGN',
      amount: 95,
      status: paid ? 'completed' : 'pending',
      platform_fee: 1,
      metadata: {},
      gateway_response: paid ? data : null,
    };
    const row =
      table === 'transactions'
        ? transaction
        : table === 'merchants'
          ? merchant
          : { ...order, payment_status: paid ? 'paid' : 'unpaid' };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn((key, value) => {
        filters[key] = value;
        return chain;
      }),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockResolvedValue({ data: [], error: null }),
      limit: vi.fn().mockResolvedValue({
        data: [{ order_id: orderId, transaction_id: transactionId }],
        error: null,
      }),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
      maybeSingle: vi.fn(async () => ({
        data:
          table === 'merchants' &&
          filters.slug &&
          filters.slug !== merchant.slug
            ? null
            : row,
        error: null,
      })),
      order: vi.fn(async () => ({
        data: filters.transaction_type === 'payment' ? [transaction] : [],
        error: null,
      })),
      insert: refundInsert,
    };
    return chain;
  });
  return { data, refundInsert };
}

describe('bank card offer payment handlers', () => {
  it('requires CSRF proof before reserving a bank-offer checkout', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    setup('035', 'Wema Bank');
    mocks.csrf.mockResolvedValueOnce({ valid: false });

    const response = await initialize(
      request('initialize', {
        merchant_id: merchantId,
        order_id: orderId,
        payment_method: 'bank_card_offer',
        currency: 'NGN',
        customer_email: customerEmail,
        customer_name: 'Buyer',
        customer_phone: '08012345678',
        gateway: 'paystack',
      })
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it('records the terminal review for a buyer using native verification', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    mocks.cookieAuth.mockResolvedValueOnce({
      authMode: 'bearer',
      user: { id: userId },
      supabase: mocks,
    });
    mocks.verify.mockResolvedValueOnce({
      success: true,
      data: { ...data, status: 'abandoned' },
    });

    const result = await verify(
      new NextRequest('http://localhost/api/payments/verify', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer test-only',
        },
        body: JSON.stringify({ reference }),
      })
    );

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toMatchObject({
      status: 'abandoned',
      orderId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.objectContaining({ p_status: 'abandoned' })
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    'cookie',
    'bearer',
  ] as const)('rejects %s verification from the wrong storefront before contacting Paystack', async (authMode) => {
    setup('035', 'Wema Bank');
    mocks.cookieAuth.mockResolvedValueOnce({
      authMode,
      user: { id: userId },
      supabase: mocks,
    });
    const wrongStoreRequest = request('verify', {
      reference,
      merchantSlug: 'another-store',
    });
    if (authMode === 'bearer')
      wrongStoreRequest.headers.set('authorization', 'Bearer test-only');
    const result = await verify(wrongStoreRequest);

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_VERIFICATION_DENIED',
    });
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalledWith('transactions');
  });

  it.each([
    { error: null, status: 200 },
    { error: { code: '57014' }, status: 503 },
  ])('distinguishes a missing signed capture from a lookup outage ($status)', async ({
    error,
    status,
  }) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { refundInsert } = setup('035', 'Wema Bank', { data: null, error });
    const response = await webhook(
      request(
        'webhook',
        {
          event: 'charge.success',
          data: {
            reference,
            metadata: { merchant_id: merchantId, order_id: orderId },
          },
        },
        true
      )
    );
    expect(response.status).toBe(status);
    if (error) {
      expect(refundInsert).not.toHaveBeenCalled();
    } else {
      await expect(response.json()).resolves.toMatchObject({
        code: 'PAYSTACK_PAYMENT_MATCH_ZERO_CANDIDATES',
      });
      expect(refundInsert).toHaveBeenCalledWith({
        issue_type: 'payment_match_zero_candidates',
        paystack_ref: reference,
        reason:
          'Signed bank-offer charge webhook did not match a saved payment attempt',
        metadata: { source: 'bank_card_offer_webhook' },
      });
    }
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    'provider timeout',
    'save rejected',
    'incorrect amount echoed',
  ] as const)('opens a recovery review after %s without another provider call', async (failure) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    setup('035', 'Wema Bank', undefined, failure !== 'save rejected');
    if (failure === 'provider timeout') {
      mocks.initialize.mockRejectedValueOnce(new Error('Connection closed'));
    }
    if (failure === 'incorrect amount echoed') {
      mocks.initialize.mockResolvedValueOnce({
        reference,
        authorization_url: 'https://checkout.paystack.com/trx/example',
        amount: 9501,
      });
    }
    const input = {
      merchant_id: merchantId,
      order_id: orderId,
      payment_method: 'bank_card_offer',
      currency: 'NGN',
      customer_email: customerEmail,
      customer_name: 'Buyer',
      customer_phone: '08012345678',
      gateway: 'paystack',
    };
    expect((await initialize(request('initialize', input))).status).toBe(202);
    expect((await initialize(request('initialize', input))).status).toBe(202);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'request_bank_card_offer_initialization_review',
      expect.objectContaining({ p_reference: reference, p_failed: true })
    );
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'record_bank_card_offer_checkout_url'
      )
    ).toHaveLength(failure === 'save rejected' ? 1 : 0);
  });

  it.each([
    { amount: 9501 },
    { currency: 'USD' },
  ])('keeps verification pending for a capture that differs from the saved payable (%j)', async (changes) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, ...changes },
    });

    const response = await verify(request('verify', { reference }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'approve_bank_card_offer_capture',
      expect.anything()
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );
  });

  it.each([
    { domain: 'live' },
    { reference: 'different-reference' },
  ])('quarantines mismatched terminal evidence %j', async (mismatch) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, status: 'failed', ...mismatch },
    });

    const result = await verify(request('verify', { reference }));
    expect(result.status).toBe(202);
    await expect(result.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.anything()
    );
  });

  it.each([
    { status: 'failed', amount: 9500 },
    { status: 'abandoned', amount: 9500 },
    { status: 'cancelled', amount: 9500 },
    { status: 'reversed', amount: 9500 },
    { status: 'failed', amount: 1 },
  ])('holds the attempt after $status with a reported amount of $amount kobo', async ({
    status,
    amount,
  }) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank');
    const input = {
      merchant_id: merchantId.toUpperCase(),
      order_id: orderId,
      payment_method: 'bank_card_offer',
      currency: 'NGN',
      customer_email: customerEmail,
      customer_name: 'Buyer',
      customer_phone: '08012345678',
      gateway: 'paystack',
    };
    expect((await initialize(request('initialize', input))).status).toBe(200);

    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, status, amount },
    });
    const callback = await verify(request('verify', { reference }));
    expect(callback.status).toBe(200);
    await expect(callback.json()).resolves.toMatchObject({
      success: false,
      status,
      orderId,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.objectContaining({
        p_transaction_id: transactionId,
        p_status: status,
      })
    );
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );

    const repeated = await initialize(request('initialize', input));
    expect(repeated.status).toBe(202);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['035', 'Wema Bank', 'Sterling Bank'],
    ['232', 'Sterling Bank', 'Wema Bank'],
  ] as const)('initializes, verifies, and refunds bank %s using the saved offer', async (bankCode, issuer, wrongIssuer) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    vi.stubEnv('NEXT_PUBLIC_ROOT_DOMAIN', 'usebaci.com');
    const { data, refundInsert } = setup(bankCode, issuer);
    const input = {
      merchant_id: merchantId,
      order_id: orderId,
      payment_method: 'bank_card_offer',
      amount: 100,
      currency: 'NGN',
      customer_email: customerEmail,
      customer_name: 'Buyer',
      customer_phone: '08012345678',
      gateway: 'paystack',
    };
    const started = await initialize(request('initialize', input));
    expect(started.status, await started.clone().text()).toBe(200);
    expect(mocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        reference,
        amount: 9500,
        callback_url: `https://ogabassey.usebaci.com/checkout/success?reference=${reference}`,
        metadata: expect.objectContaining({
          custom_filters: { banks: [bankCode], card_brands: ['visa'] },
        }),
      })
    );
    expect((await initialize(request('initialize', input))).status).toBe(200);
    expect(mocks.initialize).toHaveBeenCalledTimes(1);

    const wrong = {
      ...data,
      authorization: { ...data.authorization, bank: wrongIssuer },
    };
    mocks.verify.mockResolvedValue({ success: true, data: wrong });
    const ignored = await webhook(
      request('webhook', { event: 'charge.success', data: wrong }, true)
    );
    expect(ignored.status, await ignored.clone().text()).toBe(200);
    await expect(ignored.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        paystack_ref: reference,
        metadata: { source: 'bank_card_offer_capture' },
      })
    );
    mocks.verify.mockResolvedValue({
      success: true,
      data: { ...data, reference: 'different-reference' },
    });
    const mismatchedReference = await verify(request('verify', { reference }));
    expect(mismatchedReference.status).toBe(202);
    await expect(mismatchedReference.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_CAPTURE_REVIEW',
    });

    mocks.verify.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
    expect(
      (
        await webhook(
          request('webhook', { event: 'charge.success', data }, true)
        )
      ).status
    ).toBe(503);
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_gateway_payment',
      expect.anything()
    );

    mocks.verify.mockResolvedValue({ success: true, data });
    const callCallback = () => verify(request('verify', { reference }));
    const callWebhook = () =>
      webhook(request('webhook', { event: 'charge.success', data }, true));
    const providerCallsBeforeSuccess = mocks.verify.mock.calls.length;
    const callback = bankCode === '035' ? await callCallback() : null;
    const delivered = await callWebhook();
    expect(delivered.status, await delivered.clone().text()).toBe(200);
    const verifiedCallback = callback ?? (await callCallback());
    expect(verifiedCallback.status, await verifiedCallback.clone().text()).toBe(
      200
    );
    expect(await verifiedCallback.json()).toMatchObject({
      success: true,
      finalizationOutcome: 'completed',
    });
    expect(mocks.verify).toHaveBeenCalledTimes(providerCallsBeforeSuccess + 2);
    mocks.verify.mockResolvedValue({ success: false, code: 'NETWORK_ERROR' });
    expect((await callCallback()).status).toBe(500);
    expect((await callWebhook()).status).toBe(503);
    expect(mocks.verify).toHaveBeenCalledTimes(providerCallsBeforeSuccess + 4);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'approve_bank_card_offer_capture',
      expect.objectContaining({
        p_evidence: expect.objectContaining({
          issuerName: issuer,
          amountKobo: 9500,
          reference,
        }),
      })
    );

    await expect(
      executeOrderCancellationSideEffect({
        merchant,
        order: { ...order, payment_status: 'paid' },
        step: 'refund',
        supabase: mocks as never,
      })
    ).resolves.toEqual({ refundIds: [64] });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'get_bank_card_offer_refundable_amount',
      {
        p_order_id: orderId,
        p_merchant_id: merchantId,
        p_transaction_id: transactionId,
        p_reference: reference,
      }
    );
    expect(mocks.refund).toHaveBeenCalledWith(
      reference,
      9500,
      'Order cancelled',
      undefined
    );
    expect(refundInsert).toHaveBeenCalledWith(
      expect.objectContaining({ gateway_reference: '64' })
    );
  });

  it('recovers an approved capture after Paystack verification is available again', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank', undefined, true, true);

    expect((await verify(request('verify', { reference }))).status).toBe(500);
    mocks.verify.mockResolvedValueOnce({
      success: false,
      code: 'NETWORK_ERROR',
    });
    expect((await verify(request('verify', { reference }))).status).toBe(500);
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'complete_order_gateway_payment'
      )
    ).toHaveLength(1);

    mocks.verify.mockResolvedValueOnce({ success: true, data });
    const replay = await verify(request('verify', { reference }));
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({ success: true });
    expect(mocks.verify).toHaveBeenCalledTimes(3);
  });

  it('reviews a reversal after approval without retrying settlement', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    const { data } = setup('035', 'Wema Bank', undefined, true, true);

    expect((await verify(request('verify', { reference }))).status).toBe(500);
    mocks.verify.mockResolvedValueOnce({
      success: true,
      data: { ...data, status: 'reversed' },
    });

    const replay = await verify(request('verify', { reference }));

    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toMatchObject({
      success: false,
      status: 'reversed',
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      'flag_bank_card_offer_terminal_review',
      expect.objectContaining({ p_status: 'reversed' })
    );
    expect(
      mocks.rpc.mock.calls.filter(
        ([name]) => name === 'complete_order_gateway_payment'
      )
    ).toHaveLength(1);
  });
});
