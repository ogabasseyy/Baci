vi.mock('./check-cancellation-refund-provider', () => ({
  checkCancellationRefundProvider: vi.fn().mockResolvedValue([]),
}));

import { vi } from 'vitest';

const refundMocks = vi.hoisted(() => ({ initiateRefund: vi.fn() }));

vi.mock('@/lib/initiate-paystack-refund', () => ({
  initiateRefund: refundMocks.initiateRefund,
}));
vi.mock('@/lib/orders/build-order-cancellation-email-message', () => ({
  buildOrderCancellationEmailMessage: vi.fn(),
}));

import { executeOrderCancellationSideEffect as executeSideEffect } from './execute-order-cancellation-side-effect';
import { auditReviewsQuery as buildAuditQuery } from './execute-order-cancellation-side-effect.test-support';

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

export function transactionQuery(data: unknown) {
  return {
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockResolvedValue({ data, error: null }),
    select: vi.fn().mockReturnThis(),
  };
}

export const auditReviewsQuery = buildAuditQuery;
export const executeOrderCancellationSideEffect = executeSideEffect;
export const mocks = refundMocks;
