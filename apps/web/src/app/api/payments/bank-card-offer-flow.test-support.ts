import { randomBytes } from 'node:crypto';
import { vi } from 'vitest';
import { hashBankCardOfferFilter } from '@/lib/checkout/hash-bank-card-offer-filter';
import { merchantSlug } from './bank-card-offer-request.test-support';

export { request } from './bank-card-offer-request.test-support';

import { mocks, userId } from './bank-card-offer-flow-mocks.test-support';

export const merchantId = '6b5cb8a4-5575-456c-b936-8cdfae30db74';
export const orderId = 'b32deabd-77d7-45db-b28d-ccdd58240516';
export const transactionId = 'ad3c848c-da33-4405-bd41-ae00db772a0e';
const itemId = 'ef8cd4bb-010e-4ce6-ab1a-9a29ef36569f';
const productId = 'f37548d2-5d3a-41cf-8109-6a82a1684567';
export const customerEmail = 'buyer@example.com';
export const reference = 'BCO-1234567890abcdef1234567890abcdef';
export const secret = `sk_test_${randomBytes(32).toString('hex')}`;
export const merchant = {
  id: merchantId,
  slug: merchantSlug,
  business_name: 'Ogabassey',
  support_email: null,
  email: 'store@example.com',
  cac_rc_number: null,
  tax_identification_number: null,
  email_sender_name: null,
};
export const order = {
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

export function setup(
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
  const capture = { held: false };
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
  mocks.rpc.mockImplementation((name, args) => {
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
              transaction_status: paid ? 'completed' : 'pending',
              order_payment_status: paid ? 'paid' : 'unpaid',
              inventory_confirmed: paid,
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
      case 'get_bank_card_offer_verification_hold':
        return { data: capture.held, error: null };
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
      case 'begin_bank_card_offer_refund_dispatch':
        return {
          data:
            paid &&
            args.p_reference === reference &&
            args.p_claim_token === 'refund-claim'
              ? 'dispatch'
              : 'blocked',
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
  return { data, refundInsert, capture };
}
