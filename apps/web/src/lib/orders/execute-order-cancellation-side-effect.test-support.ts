import { vi } from 'vitest';

export const merchant = {
  business_name: 'Store',
  cac_rc_number: null,
  email: 'store@example.com',
  email_sender_name: null,
  id: 'merchant-1',
  slug: 'store',
  support_email: null,
  tax_identification_number: null,
};

export const order = {
  amount_paid: 100,
  currency: 'NGN',
  customer_email: 'buyer@example.com',
  customer_id: null,
  customer_name: 'Buyer',
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  total: 100,
};

export const paystackPayment = {
  amount: 100,
  currency: 'NGN',
  gateway: 'paystack',
  gateway_reference: 'ref-1',
  id: 'payment-1',
};

function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

export function auditReviewsQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    is: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

export function refundClient({
  auditReviews = [],
  insertError = null,
  payments = [paystackPayment],
  refundRows = [],
}: {
  auditReviews?: unknown[];
  insertError?: Error | null;
  payments?: (typeof paystackPayment)[];
  refundRows?: {
    amount?: number;
    currency?: string;
    gateway?: string;
    metadata: Record<string, unknown>;
    status: string;
  }[];
} = {}) {
  const insert = vi.fn().mockResolvedValue({ error: insertError });
  const update = vi.fn().mockReturnValue({
    eq: vi.fn().mockReturnThis(),
  });
  const paymentLookup = transactionQuery(payments);
  const from = vi
    .fn()
    .mockReturnValueOnce(paymentLookup)
    .mockReturnValueOnce(transactionQuery(refundRows))
    .mockReturnValueOnce(auditReviewsQuery(auditReviews));
  for (const _payment of payments) {
    from.mockReturnValueOnce({ insert, update });
  }
  return { from, insert, paymentLookup, update };
}
