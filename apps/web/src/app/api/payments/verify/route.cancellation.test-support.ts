import { NextRequest } from 'next/server';
import { vi } from 'vitest';

vi.mock('next/server', async () => {
  const actual =
    await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (callback: () => void | Promise<void>) => {
      void Promise.resolve(callback()).catch(() => {
        // Ignore background task errors in tests.
      });
    },
  };
});

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() => Promise.resolve({ valid: true })),
}));

const mockVerifyPaystack = vi.fn();
vi.mock('@/lib/paystack', () => ({
  verifyTransaction: (...args: unknown[]) => mockVerifyPaystack(...args),
}));

vi.mock('@/lib/korapay', () => ({
  verifyPayment: vi.fn(),
}));

const mockNotifyNewOrder = vi.fn();
const mockNotifyPaymentReceived = vi.fn();
vi.mock('@/lib/expo-push', () => ({
  notifyNewOrder: (...args: unknown[]) => mockNotifyNewOrder(...args),
  notifyPaymentReceived: (...args: unknown[]) =>
    mockNotifyPaymentReceived(...args),
}));

// The verify route now runs the same claim-gated outbox as the webhook via
// finalizeOrderGatewayPayment; the outbox itself is unit-tested elsewhere.
const mockRunPaidOrderSideEffects = vi.fn().mockResolvedValue({
  concurrentTakeoverSteps: [],
  failedSteps: [],
  ranSteps: [],
  skippedSteps: [],
});
vi.mock('@/lib/payments/run-paid-order-side-effects', () => ({
  runPaidOrderSideEffects: (...args: unknown[]) =>
    mockRunPaidOrderSideEffects(...args),
}));

const mockProcessMerchantInvoicePartialPayment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/process-merchant-invoice-partial-payment', () => ({
  processMerchantInvoicePartialPayment: (...args: unknown[]) =>
    mockProcessMerchantInvoicePartialPayment(...args),
}));

const mockCaptureOrHoldRedvaultPayment = vi.hoisted(() => vi.fn());
vi.mock('@/lib/payments/redvault-capture-hold', () => ({
  captureOrHoldRedvaultPayment: (...args: unknown[]) =>
    mockCaptureOrHoldRedvaultPayment(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const getBankCardOfferBinding = vi.hoisted(() => vi.fn());
vi.mock('./get-bank-card-offer-verification-binding', () => ({
  getBankCardOfferVerificationBinding: getBankCardOfferBinding,
}));

const mockCreateServiceClient = vi.fn();
vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => mockCreateServiceClient(),
}));

// handlePaymentForCancelledOrder files the reconciliation row through a
// service-role admin client (reconciliation_review is RLS-locked to
// service_role), not the route's own service client.
const mockReconciliationInsert = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: null, error: null })
);
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: vi.fn((table: string) => {
      if (table === 'reconciliation_review') {
        return { insert: mockReconciliationInsert };
      }
      throw new Error(`Unexpected admin table: ${table}`);
    }),
  })),
}));

import { POST } from './route';

const REFERENCE = 'BAC-VERIFY-1';

function createRequest(reference = REFERENCE, merchantSlug?: string) {
  return new NextRequest('http://localhost:3000/api/payments/verify', {
    body: JSON.stringify({ reference, merchantSlug }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
}

const richOrderRow = {
  ad_tracking: null,
  cancelled_at: null,
  currency: 'NGN',
  customer_email: 'jane@example.com',
  customer_id: 'cust-1',
  customer_name: 'Jane',
  customer_phone: '+234',
  discount_amount: 0,
  gift_wrapping_fee: 0,
  id: 'order-1',
  merchant_id: 'merchant-1',
  order_items: [],
  order_number: 'ORD-1',
  payment_status: 'paid',
  shipping_address: {},
  shipping_fee: 0,
  shipping_status: 'processing',
  subtotal: 1000,
  tax_amount: 0,
  tax_basis: null,
  total: 1000,
  updated_at: '2026-07-13T00:00:00Z',
};

function buildSupabase({
  transactionStatus = 'pending',
  existingOrderStatus = 'unpaid',
  gateway = 'paystack',
  gatewayResponse = { fees: 123, status: 'success' } as Record<
    string,
    unknown
  > | null,
  metadata = {} as Record<string, unknown>,
  completion,
  inventoryConfirmationError = null,
}: {
  transactionStatus?: string;
  existingOrderStatus?: string;
  gateway?: string;
  gatewayResponse?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  completion: Record<string, unknown> | null;
  inventoryConfirmationError?: unknown;
}) {
  const normalizedCompletion =
    completion && !('error_code' in completion)
      ? {
          actor: 'verify:BAC-VERIFY-1',
          already_completed: false,
          cancelled_at: null,
          order_already_paid: false,
          order_cancelled: false,
          order_number: 'ORD-1',
          order_skipped_status: null,
          order_updated: false,
          payment_status: existingOrderStatus,
          previous_payment_status: existingOrderStatus,
          previous_shipping_status: 'pending',
          shipping_status: 'processing',
          ...completion,
        }
      : completion;
  const rpc = vi.fn((name: string) => {
    const data =
      name === 'complete_order_gateway_payment'
        ? normalizedCompletion
        : name === 'reinstate_timeout_order_payment'
          ? 'blocked'
          : name === 'claim_payment_side_effect'
            ? { current_status: 'claimed', we_won: true }
            : null;
    const result = {
      data,
      error:
        name === 'confirm_order_inventory_reservations'
          ? inventoryConfirmationError
          : null,
    };
    return Object.assign(Promise.resolve(result), {
      single: () => Promise.resolve(result),
    });
  });

  const from = vi.fn((table: string) => {
    if (table === 'transactions') {
      return {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            amount: 1000,
            currency: 'NGN',
            gateway,
            gateway_reference: REFERENCE,
            gateway_response: gatewayResponse,
            id: 'txn-1',
            merchant_id: 'merchant-1',
            metadata,
            order_id: 'order-1',
            platform_fee: 0,
            status: transactionStatus,
          },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      };
    }
    if (table === 'orders') {
      // existingOrder lookup uses .maybeSingle(); the finalizer's rich
      // order fetch uses .single().
      return {
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            id: 'order-1',
            order_number: 'ORD-1',
            payment_status: existingOrderStatus,
            shipping_status: 'pending',
            total: 21500,
          },
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: richOrderRow, error: null }),
      };
    }
    if (table === 'payment_side_effects') {
      return {
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              error: 'side_effect_failed',
              status: 'failed',
              transaction_id: 'txn-1',
            },
          ],
          error: null,
        }),
        select: vi.fn().mockReturnThis(),
      };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return { from, rpc };
}

export const verificationRouteFixtures = {
  POST,
  createRequest,
  buildSupabase,
  mockCreateServiceClient,
  mockVerifyPaystack,
  getBankCardOfferBinding,
  mockRunPaidOrderSideEffects,
  mockProcessMerchantInvoicePartialPayment,
  mockCaptureOrHoldRedvaultPayment,
  mockNotifyNewOrder,
  mockReconciliationInsert,
  REFERENCE,
};
