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
  ...(await importOriginal<typeof import('@/env')>()),
  env: {
    get PAYSTACK_SECRET_KEY() {
      return process.env.PAYSTACK_SECRET_KEY;
    },
  },
  getSupabaseUrl: () => 'https://synthetic.example.test',
  getSupabaseAnonKey: () => 'synthetic',
}));
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: vi.fn(),
}));
vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: async () => ({ user: { id: userId } }),
}));
vi.mock('@/lib/supabase/mobile-auth', () => ({
  getAuthenticatedUser: async () => ({ user: { id: userId } }),
}));
vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: async () => ({ valid: true }),
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
  const body = JSON.stringify(payload);
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

function setup(bankCode: '035' | '232', issuerName: string) {
  let claimed = false;
  let checkoutUrl: string | null = null;
  let approved = false;
  let paid = false;
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
        return { data: { claimed: newClaim, reference, checkoutUrl } };
      }
      case 'record_bank_card_offer_checkout_url':
        checkoutUrl = args.p_checkout_url;
        return { data: true };
      case 'get_bank_card_offer_verification_context':
        return {
          data: {
            quote,
            domain: 'test',
            reference,
            amountKobo: 9500,
            customerEmail,
            acceptedFilterPolicyHash: hashBankCardOfferFilter(
              quote.paymentPolicy
            ),
          },
        };
      case 'approve_bank_card_offer_capture':
        approved = args.p_evidence.issuerName === issuerName;
        return { data: approved };
      case 'complete_order_gateway_payment': {
        if (!approved) throw new Error('completion before issuer approval');
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
      case 'bank_card_offer_refund_capture_matches':
        return {
          data:
            paid &&
            args.p_amount_kobo === 9500 &&
            args.p_reference === reference,
        };
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
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
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
  it('opens a recovery review for an uncertain initialization without another provider call', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
    setup('035', 'Wema Bank');
    mocks.initialize.mockRejectedValueOnce(new Error('Connection closed'));
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
      'flag_bank_card_offer_initialization_review',
      expect.objectContaining({ p_reference: reference, p_failed: true })
    );
  });

  it.each([
    ['035', 'Wema Bank', 'Sterling Bank'],
    ['232', 'Sterling Bank', 'Wema Bank'],
  ] as const)('initializes, verifies, and refunds bank %s using the saved offer', async (bankCode, issuer, wrongIssuer) => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', secret);
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
});
