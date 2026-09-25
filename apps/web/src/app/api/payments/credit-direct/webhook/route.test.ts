import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

// ============================================================================
// Mocks
// ============================================================================

// Mock Next.js server with after function
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return {
    ...actual,
    after: vi.fn((callback: () => void | Promise<void>) => {
      Promise.resolve(callback()).catch(() => {
        // Ignore background task errors in tests
      });
    }),
  };
});

vi.mock('@/lib/credit-direct', () => ({
  getWebhookSecret: vi.fn(),
  verifyWebhookSignature: vi.fn(),
  parseWebhookPayload: vi.fn(),
  calculatePlatformFee: vi.fn(),
  calculateMerchantAmount: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: vi.fn(),
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

vi.mock('@/lib/payments/ensure-paid-order-inventory-confirmed', () => ({
  ensurePaidOrderInventoryConfirmed: vi.fn().mockResolvedValue(undefined),
  rollbackOrderStatusAfterInventoryConfirmationFailure: vi
    .fn()
    .mockResolvedValue(undefined),
}));

vi.mock('@/lib/payments/file-inventory-confirmation-review', () => ({
  fileInventoryConfirmationFailureReview: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/payments/inventory-confirmation-response', () => ({
  buildInventoryConfirmationFailurePayload: vi.fn((error: unknown) => ({
    code:
      error instanceof Error &&
      error.message === 'serialized_inventory_unavailable'
        ? 'serialized_inventory_unavailable'
        : 'INVENTORY_CONFIRMATION_FAILED',
    error:
      error instanceof Error ? error.message : 'Inventory confirmation failed',
  })),
}));

vi.mock('@/lib/payments/resolve-credit-direct-confirmation-review', () => ({
  resolveCreditDirectConfirmationReview: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/lib/zeptomail', () => ({
  sendEmail: vi.fn(() => Promise.resolve({ success: true })),
}));

// ============================================================================
// Setup
// ============================================================================

const {
  getWebhookSecret,
  verifyWebhookSignature,
  parseWebhookPayload,
  calculatePlatformFee,
  calculateMerchantAmount,
} = await import('@/lib/credit-direct');
const actualCreditDirect = await vi.importActual<
  typeof import('@/lib/credit-direct')
>('@/lib/credit-direct');
const { createServiceClient } = await import('@/lib/supabase/service');
const { logger } = await import('@/lib/logger');
const {
  ensurePaidOrderInventoryConfirmed,
  rollbackOrderStatusAfterInventoryConfirmationFailure,
} = await import('@/lib/payments/ensure-paid-order-inventory-confirmed');
const { fileInventoryConfirmationFailureReview } = await import(
  '@/lib/payments/file-inventory-confirmation-review'
);
const { resolveCreditDirectConfirmationReview } = await import(
  '@/lib/payments/resolve-credit-direct-confirmation-review'
);
const { sendEmail } = await import('@/lib/zeptomail');

// ============================================================================
// Test Data
// ============================================================================

const VALID_SIGNATURE = 'valid-signature';
const VALID_SVIX_ID = 'msg_123456789';
const VALID_SVIX_TIMESTAMP = '1700000000';

const customerPaymentPayload = {
  checkoutCustomer: {
    firstName: 'John',
    lastName: 'Doe',
  },
  checkoutTransactionId: 'txn_123456789',
  eventType: 'Checkout_Customer_Payment_Completed' as const,
  metaData: 'order_abc',
  products: [
    {
      productName: 'Product 1',
      productAmount: 50000,
      productId: 'prod_1',
    },
  ],
  timeStamp: '2024-01-15T10:30:00Z',
};

const merchantPaymentPayload = {
  checkoutCustomer: {
    firstName: 'John',
    lastName: 'Doe',
  },
  checkoutTransactionId: 'txn_123456789',
  eventType: 'Checkout_Merchant_Payment_Completed' as const,
  metaData: 'order_abc',
  products: [
    {
      productName: 'Product 1',
      productAmount: 50000,
      productId: 'prod_1',
    },
  ],
  timeStamp: '2024-01-15T11:00:00Z',
};

const mockOrder = {
  id: 'order_abc',
  merchant_id: 'merchant_123',
  total: 50000,
  payment_status: 'pending',
  payment_method: 'credit_direct',
  customer_email: 'customer@example.com',
  customer_name: 'John Doe',
  notes: JSON.stringify({
    creditDirectSessionId: 'session_123456789',
    creditDirectTransactionId: 'txn_123456789',
    credit_directTransactionId: 'txn_123456789',
    creditDirectSignedAmount: 50000,
  }),
  order_number: 'ORD-123',
};

// ============================================================================
// Helper Functions
// ============================================================================

function createMockRequest(
  payload: unknown,
  headers: Record<string, string> = {},
  options: { includeSignatureHeaders?: boolean } = {}
): NextRequest {
  const includeSignatureHeaders = options.includeSignatureHeaders ?? true;

  return new NextRequest(
    'https://example.com/api/payments/credit-direct/webhook',
    {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        ...(includeSignatureHeaders
          ? {
              'svix-id': VALID_SVIX_ID,
              'svix-timestamp': VALID_SVIX_TIMESTAMP,
              'svix-signature': VALID_SIGNATURE,
            }
          : {}),
        ...headers,
      },
    }
  );
}

function createMockSupabaseClient() {
  const mockChain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    ilike: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  };

  return {
    from: vi.fn((_table: string) => mockChain),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('POST /api/payments/credit-direct/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    vi.mocked(getWebhookSecret).mockReturnValue('webhook_secret');
    vi.mocked(verifyWebhookSignature).mockReturnValue(true);
    vi.mocked(calculatePlatformFee).mockReturnValue(1000);
    vi.mocked(calculateMerchantAmount).mockReturnValue(49000);
    // Set production mode by default
    vi.stubEnv('NODE_ENV', 'production');
  });

  describe('Webhook Secret Validation', () => {
    it('returns 500 when webhook secret is not configured', async () => {
      vi.mocked(getWebhookSecret).mockImplementation(() => {
        throw new Error('Secret not configured');
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Webhook secret not configured' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Credit Direct webhook secret not configured',
      });
    });
  });

  describe('Signature Verification', () => {
    it('returns 401 when signature is invalid in production', async () => {
      vi.mocked(verifyWebhookSignature).mockReturnValue(false);

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Invalid signature' });
      expect(logger.warn).toHaveBeenCalledWith({
        message: 'Invalid Credit Direct webhook signature',
      });
      expect(verifyWebhookSignature).toHaveBeenCalledWith({
        rawBody: JSON.stringify(customerPaymentPayload),
        secret: 'webhook_secret',
        svixId: VALID_SVIX_ID,
        svixTimestamp: VALID_SVIX_TIMESTAMP,
        svixSignature: VALID_SIGNATURE,
      });
    });

    it('returns 401 when Svix signature headers are missing in production', async () => {
      vi.mocked(verifyWebhookSignature).mockReturnValue(false);

      const request = createMockRequest(
        customerPaymentPayload,
        {},
        { includeSignatureHeaders: false }
      );
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data).toEqual({ error: 'Invalid signature' });
      expect(parseWebhookPayload).not.toHaveBeenCalled();
      expect(verifyWebhookSignature).toHaveBeenCalledWith({
        rawBody: JSON.stringify(customerPaymentPayload),
        secret: 'webhook_secret',
        svixId: null,
        svixTimestamp: null,
        svixSignature: null,
      });
    });

    it('skips signature verification in development when no signature provided', async () => {
      vi.stubEnv('NODE_ENV', 'development');
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // First from('orders') - order lookup
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        } else if (fromCallCount === 2) {
          // Second from('orders') - order update
          const updateChain = { ...createMockSupabaseClient().from('orders') };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.in = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: { id: 'order_abc' },
            error: null,
          });
          return updateChain;
        }
        return createMockSupabaseClient().from(table);
      });

      const request = createMockRequest(
        customerPaymentPayload,
        {},
        { includeSignatureHeaders: false }
      );
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(verifyWebhookSignature).not.toHaveBeenCalled();
    });
  });

  describe('Payload Validation', () => {
    it('returns 400 when payload structure is invalid', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(null);

      const request = createMockRequest({ invalid: 'payload' });
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid payload structure' });
      expect(logger.warn).toHaveBeenCalledWith({
        message: 'Invalid Credit Direct webhook payload structure',
        payloadKeys: ['invalid'],
        svixId: VALID_SVIX_ID,
      });
    });

    it('returns 400 when JSON parsing fails', async () => {
      const request = new NextRequest(
        'https://example.com/api/payments/credit-direct/webhook',
        {
          method: 'POST',
          body: 'invalid-json',
          headers: {
            'Content-Type': 'application/json',
            'svix-id': VALID_SVIX_ID,
            'svix-timestamp': VALID_SVIX_TIMESTAMP,
            'svix-signature': VALID_SIGNATURE,
          },
        }
      );

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid JSON payload' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Failed to parse Credit Direct webhook body',
      });
    });
  });

  describe('Order Lookup', () => {
    it('returns 200 with warning when order is not found', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');

      // Mock order lookup by notes (not found)
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [],
        error: null,
      });

      // Mock order lookup by metaData (not found)
      mockChain.single.mockResolvedValue({
        data: null,
        error: null,
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true, warning: 'Order not found' });
      expect(mockChain.in).toHaveBeenCalledWith('payment_method', [
        'credit_direct',
        'klump',
      ]);
      expect(logger.warn).toHaveBeenCalledWith({
        message: 'Order not found for Credit Direct webhook',
        transactionId: 'txn_123456789',
        metaData: 'order_abc',
      });
    });

    it('returns 500 when database query fails', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: null,
        error: { message: 'Database error' },
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to find order' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Failed to find order for Credit Direct webhook',
        error: { message: 'Database error' },
        transactionId: 'txn_123456789',
      });
    });

    it('uses metadata fallback lookup so stale provider switches can be classified', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const firstLookupChain = {
        ...createMockSupabaseClient().from('orders'),
      };
      firstLookupChain.select = vi.fn().mockReturnValue(firstLookupChain);
      firstLookupChain.eq = vi.fn().mockReturnValue(firstLookupChain);
      firstLookupChain.ilike = vi
        .fn()
        .mockResolvedValue({ data: [], error: null });

      const metadataLookupChain = {
        ...createMockSupabaseClient().from('orders'),
      };
      metadataLookupChain.select = vi.fn().mockReturnValue(metadataLookupChain);
      metadataLookupChain.eq = vi.fn().mockReturnValue(metadataLookupChain);
      metadataLookupChain.single = vi
        .fn()
        .mockResolvedValue({ data: null, error: null });

      supabaseMock.from
        .mockReturnValueOnce(firstLookupChain)
        .mockReturnValueOnce(metadataLookupChain);

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(metadataLookupChain.eq).toHaveBeenCalledWith(
        'id',
        customerPaymentPayload.metaData
      );
    });
  });

  describe('Customer Payment Completed Event', () => {
    it('accepts a webhook that matches the active popup transaction even when the signed session differs', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const updateSpy = vi.fn();
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [
              {
                ...mockOrder,
                payment_method: 'credit_direct',
                notes: JSON.stringify({
                  creditDirectSessionId: 'session_123456789',
                  creditDirectTransactionId: 'txn_123456789',
                  credit_directTransactionId: 'txn_123456789',
                  creditDirectSignedAmount: 50000,
                }),
              },
            ],
            error: null,
          });
          return orderLookupChain;
        }

        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = updateSpy.mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.in = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: { id: 'order_abc' }, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'bnpl_approved' })
      );
    });

    it('accepts a webhook that matches the active signed session before a popup transaction is stored', async () => {
      const sessionPayload = {
        ...customerPaymentPayload,
        checkoutTransactionId: 'session_123456789',
      };
      vi.mocked(parseWebhookPayload).mockReturnValue(sessionPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const updateSpy = vi.fn();
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [
              {
                ...mockOrder,
                payment_method: 'credit_direct',
                notes: JSON.stringify({
                  creditDirectSessionId: 'session_123456789',
                  creditDirectSignedAmount: 50000,
                }),
              },
            ],
            error: null,
          });
          return orderLookupChain;
        }

        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = updateSpy.mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.in = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: { id: 'order_abc' }, error: null });
        return updateChain;
      });

      const request = createMockRequest(sessionPayload);
      const response = await POST(request);

      expect(response.status).toBe(200);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ payment_status: 'bnpl_approved' })
      );
    });

    it('ignores a stale Credit Direct webhook for an inactive transaction reference', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const updateSpy = vi.fn();
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [
              {
                ...mockOrder,
                payment_method: 'credit_direct',
                notes: JSON.stringify({
                  creditDirectSessionId: 'older_credit_direct_session',
                  creditDirectTransactionId: 'older_credit_direct_transaction',
                  credit_directTransactionId: 'older_credit_direct_transaction',
                  creditDirectSignedAmount: 50000,
                }),
              },
            ],
            error: null,
          });
          return orderLookupChain;
        }

        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = updateSpy.mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        warning: 'Stale Credit Direct session',
      });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith({
        message: 'Ignoring stale Credit Direct webhook for inactive session',
        orderId: 'order_abc',
        orderPaymentMethod: 'credit_direct',
        activeReference: 'older_credit_direct_transaction',
        transactionId: 'txn_123456789',
      });
    });

    it('ignores a stale Credit Direct webhook after the order switches payment provider', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const updateSpy = vi.fn();
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [
              {
                ...mockOrder,
                payment_method: 'klump',
                notes: JSON.stringify({
                  creditDirectSessionId: 'session_123456789',
                  creditDirectTransactionId: 'txn_123456789',
                  credit_directTransactionId: 'txn_123456789',
                  creditDirectSignedAmount: 50000,
                }),
              },
            ],
            error: null,
          });
          return orderLookupChain;
        }

        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = updateSpy.mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockResolvedValue({ data: null, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        warning: 'Stale Credit Direct session',
      });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith({
        message: 'Ignoring stale Credit Direct webhook for inactive session',
        orderId: 'order_abc',
        orderPaymentMethod: 'klump',
        activeReference: 'txn_123456789',
        transactionId: 'txn_123456789',
      });
    });

    it('successfully processes customer payment completed event', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // First from('orders') - order lookup
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        } else if (fromCallCount === 2) {
          // Second from('orders') - order update
          const updateChain = { ...createMockSupabaseClient().from('orders') };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.in = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: { id: 'order_abc' }, error: null });
          return updateChain;
        }
        return createMockSupabaseClient().from(table);
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });

      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct BNPL approved for customer',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
      });
    });

    it('skips inventory confirmation when the customer approval update matches no rows', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.in = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }

        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = vi.fn().mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.in = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: null, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        warning: 'Order status no longer eligible',
      });
      expect(ensurePaidOrderInventoryConfirmed).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith({
        message:
          'Credit Direct customer payment update skipped because order status is no longer eligible',
        orderId: 'order_abc',
        currentPaymentStatus: 'pending',
        transactionId: 'txn_123456789',
      });
    });

    it('retries inventory confirmation for duplicate customer payment completed events', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const updateSpy = vi.fn();
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [{ ...mockOrder, payment_status: 'bnpl_approved' }],
            error: null,
          });
          return orderLookupChain;
        }

        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = updateSpy.mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.in = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: { id: 'order_abc' }, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(updateSpy).not.toHaveBeenCalled();
      expect(ensurePaidOrderInventoryConfirmed).toHaveBeenCalledWith(
        supabaseMock,
        'merchant_123',
        'order_abc'
      );
      expect(logger.info).toHaveBeenCalledWith({
        message:
          'Credit Direct customer payment webhook already approved; retrying inventory confirmation',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
      });
    });

    it('rolls back the approval when customer-branch inventory confirmation fails', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);
      vi.mocked(ensurePaidOrderInventoryConfirmed).mockRejectedValueOnce(
        new Error('serialized_inventory_unavailable')
      );

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = vi.fn().mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.in = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: { id: 'order_abc' }, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(409);
      expect(data.code).toBe('serialized_inventory_unavailable');
      // The bnpl_approved flip rolls back to the pre-webhook statuses
      // (the customer branch sets no amount_paid) so the status poll
      // cannot confirm an order with unconfirmed inventory. The restore
      // is fenced to rows still in bnpl_approved so a concurrent
      // merchant webhook that settled the order is never corrupted.
      expect(
        rollbackOrderStatusAfterInventoryConfirmationFailure
      ).toHaveBeenCalledWith(
        supabaseMock,
        'merchant_123',
        'order_abc',
        {
          payment_status: 'pending',
          shipping_status: null,
        },
        { onlyIfPaymentStatus: ['bnpl_approved'] }
      );
      expect(fileInventoryConfirmationFailureReview).not.toHaveBeenCalled();
    });

    it('files a reconciliation review when customer-branch rollback also fails', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);
      vi.mocked(ensurePaidOrderInventoryConfirmed).mockRejectedValueOnce(
        new Error('boom')
      );
      vi.mocked(
        rollbackOrderStatusAfterInventoryConfirmationFailure
      ).mockRejectedValueOnce(new Error('rollback boom'));

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        const updateChain = { ...createMockSupabaseClient().from(table) };
        updateChain.update = vi.fn().mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.in = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi
          .fn()
          .mockResolvedValue({ data: { id: 'order_abc' }, error: null });
        return updateChain;
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.code).toBe('INVENTORY_CONFIRMATION_CLEANUP_FAILED');
      expect(fileInventoryConfirmationFailureReview).toHaveBeenCalledWith(
        expect.objectContaining({
          orderId: 'order_abc',
          merchantId: 'merchant_123',
          transactionId: null,
        })
      );
    });

    it('returns 500 when order update fails for customer payment', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');

      let inCallCount = 0;
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.in.mockImplementation(() => {
        inCallCount++;
        if (inCallCount === 1) {
          return mockChain;
        }
        return mockChain;
      });
      mockChain.ilike.mockResolvedValue({
        data: [mockOrder],
        error: null,
      });

      mockChain.update.mockReturnValue(mockChain);
      mockChain.maybeSingle.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' },
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to update order' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Failed to update order for customer payment completion',
        error: { message: 'Update failed' },
      });
    });
  });

  describe('Merchant Payment Completed Event', () => {
    it('successfully processes merchant payment completed event', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      const orderUpdate = vi.fn();

      // Track which from() call we're on
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // First from('orders') - order lookup
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        } else if (fromCallCount === 2) {
          // Second from('orders') - order update (returns the clamped/active row)
          const updateChain = { ...mockChain };
          updateChain.update = orderUpdate.mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        } else if (fromCallCount === 3) {
          // Third from('transactions') - check existing tx
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: null,
          });
          return txCheckChain;
        } else if (fromCallCount === 4) {
          // Fourth from('transactions') - insert tx (chains .select('id').single())
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi.fn().mockResolvedValue({
            data: { id: 'cd-txn-1' },
            error: null,
          });
          return txInsertChain;
        }
        return mockChain;
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });

      // Verify from() was called for orders (twice) and transactions (twice)
      expect(supabaseMock.from).toHaveBeenCalledWith('orders');
      expect(supabaseMock.from).toHaveBeenCalledWith('transactions');
      expect(resolveCreditDirectConfirmationReview).toHaveBeenCalledWith({
        orderId: 'order_abc',
        providerReference: 'txn_123456789',
        supabase: supabaseMock,
      });
      const paidUpdate = orderUpdate.mock.calls[0]?.[0] as
        | { notes?: string }
        | undefined;
      expect(JSON.parse(paidUpdate?.notes ?? '{}')).toEqual(
        expect.objectContaining({
          creditDirectTransactionId: 'txn_123456789',
          creditDirectVerifiedWebhookWrite: true,
          creditDirectClientCompletionStatus: 'provider_confirmed',
        })
      );

      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct merchant payment completed',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
        amount: 50000,
        platformFee: 1000,
        merchantAmount: 49000,
      });
    });

    it('accepts documented string product amounts for merchant payment completed events', async () => {
      const stringAmountPayload = {
        ...merchantPaymentPayload,
        checkoutCustomer: {
          ...merchantPaymentPayload.checkoutCustomer,
          firstName: '<img src=x onerror=alert(1)>',
        },
        products: [
          {
            productName: '<script>alert(1)</script>',
            productAmount: '30000',
            productId: 'prod_1',
          },
          {
            productName: 'Product 2',
            productAmount: '20000',
            productId: 'prod_2',
          },
        ],
      };
      vi.mocked(parseWebhookPayload).mockImplementationOnce(
        actualCreditDirect.parseWebhookPayload
      );

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        }
        if (fromCallCount === 3) {
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: null,
          });
          return txCheckChain;
        }
        if (fromCallCount === 4) {
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi.fn().mockResolvedValue({
            data: { id: 'cd-txn-1' },
            error: null,
          });
          return txInsertChain;
        }
        return mockChain;
      });

      const request = createMockRequest(stringAmountPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct merchant payment completed',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
        amount: 50000,
        platformFee: 1000,
        merchantAmount: 49000,
      });
      expect(sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          htmlContent: expect.stringContaining('₦30,000'),
        })
      );
      const emailHtml = vi.mocked(sendEmail).mock.calls.at(-1)?.[0].htmlContent;
      expect(emailHtml).toContain('&lt;img');
      expect(emailHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(emailHtml).not.toContain('<script>');
      expect(emailHtml).not.toContain('<img src=x');
      expect(emailHtml).not.toContain('onerror=');
    });

    it('returns 400 when webhook product amount fails parser validation', async () => {
      const invalidAmountPayload = {
        ...merchantPaymentPayload,
        products: [
          {
            productName: 'Product 1',
            productAmount: 'not-a-number',
            productId: 'prod_1',
          },
        ],
      };
      vi.mocked(parseWebhookPayload).mockImplementationOnce(
        actualCreditDirect.parseWebhookPayload
      );

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [mockOrder],
        error: null,
      });

      const request = createMockRequest(invalidAmountPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid payload structure' });
      expect(createServiceClient).not.toHaveBeenCalled();
    });

    it('suppresses paid side effects and files reconciliation when the order was clamped as cancelled', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const transactionInsert = vi.fn().mockReturnThis();
      const amountRestoreUpdate = vi.fn().mockReturnThis();
      const mockChain = supabaseMock.from('orders');

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // order lookup
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          // order update returns the CLAMPED cancelled row
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'cancelled',
              cancelled_at: '2026-06-15T00:00:00Z',
            },
            error: null,
          });
          return updateChain;
        }
        if (fromCallCount === 3) {
          // existing-transaction idempotency check (none found)
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi
            .fn()
            .mockResolvedValue({ data: null, error: null });
          return txCheckChain;
        }
        if (table === 'transactions') {
          // insert tx — the disbursed BNPL money is recorded even though the
          // order is cancelled; chains .select('id').single().
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = transactionInsert;
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi
            .fn()
            .mockResolvedValue({ data: { id: 'cd-txn-1' }, error: null });
          return txInsertChain;
        }
        // amount_paid restore on the clamped cancelled order
        const restoreChain = { ...mockChain };
        restoreChain.update = amountRestoreUpdate;
        restoreChain.eq = vi.fn().mockResolvedValue({ error: null });
        return restoreChain;
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        message: 'Order was cancelled; payment filed for review',
      });
      // The disbursed BNPL transaction IS recorded (N4) so the money is tracked.
      expect(transactionInsert).toHaveBeenCalled();
      // The clamp branch restores the pre-webhook amount_paid so duplicate
      // deliveries still resolve the correct residual and ack.
      expect(amountRestoreUpdate).toHaveBeenCalledWith({ amount_paid: 0 });
      // Reconciliation row WAS filed through the service-role admin client,
      // linked to the recorded transaction.
      expect(mockReconciliationInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_type: 'payment_received_after_cancellation',
          order_id: 'order_abc',
          txn_id: 'cd-txn-1',
        })
      );
    });

    it('returns 400 when expected amount is invalid', async () => {
      const orderWithInvalidTotal = {
        ...mockOrder,
        total: -100,
        notes: JSON.stringify({
          creditDirectTransactionId: 'txn_123456789',
          credit_directTransactionId: 'txn_123456789',
        }),
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [orderWithInvalidTotal],
        error: null,
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Invalid payment amount' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Invalid expected amount for Credit Direct payment',
        orderId: 'order_abc',
        expectedAmount: -100,
      });
    });

    it('returns 400 when webhook amount does not match expected amount', async () => {
      const mismatchPayload = {
        ...merchantPaymentPayload,
        products: [
          {
            productName: 'Product 1',
            productAmount: 99999,
            productId: 'prod_1',
          },
        ],
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(mismatchPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [mockOrder],
        error: null,
      });

      const request = createMockRequest(mismatchPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Payment amount mismatch' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'BNPL amount does not match expected total',
        orderId: 'order_abc',
        webhookTotal: 99999,
        expectedAmount: 50000,
      });
    });

    it.each([
      [
        'no popup reference was stored',
        {
          creditDirectSessionId: 'session_123456789',
          creditDirectSignedAmount: 50000,
        },
      ],
      [
        'a legacy client stored the signed session as the popup reference',
        {
          creditDirectSessionId: 'session_123456789',
          creditDirectTransactionId: 'session_123456789',
          creditDirectSignedAmount: 50000,
        },
      ],
    ])('accepts a signed webhook when %s and metaData names the order', async (_case, notes) => {
      const sessionOnlyOrder = {
        ...mockOrder,
        notes: JSON.stringify(notes),
      };
      const unpersistedPayload = {
        ...customerPaymentPayload,
        checkoutTransactionId: 'txn_never_persisted',
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(unpersistedPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [sessionOnlyOrder],
            error: null,
          });
          return orderLookupChain;
        }
        const updateChain = { ...mockChain };
        updateChain.update = vi.fn().mockReturnValue(updateChain);
        updateChain.eq = vi.fn().mockReturnValue(updateChain);
        updateChain.select = vi.fn().mockReturnValue(updateChain);
        updateChain.maybeSingle = vi.fn().mockResolvedValue({
          data: {
            id: 'order_abc',
            payment_status: 'bnpl_approved',
            shipping_status: 'processing',
            cancelled_at: null,
          },
          error: null,
        });
        return updateChain;
      });

      const request = createMockRequest(unpersistedPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Accepting Credit Direct webhook without a persisted popup reference',
          orderId: 'order_abc',
          transactionId: 'txn_never_persisted',
        })
      );
    });

    it('still rejects an unpersisted-reference webhook when metaData names a different order', async () => {
      const sessionOnlyOrder = {
        ...mockOrder,
        notes: JSON.stringify({
          creditDirectSessionId: 'session_123456789',
        }),
      };
      const mismatchedPayload = {
        ...customerPaymentPayload,
        checkoutTransactionId: 'txn_never_persisted',
        metaData: 'order_other',
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(mismatchedPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.single.mockResolvedValue({ data: null, error: null });
      mockChain.ilike.mockResolvedValue({
        data: [sessionOnlyOrder],
        error: null,
      });

      const request = createMockRequest(mismatchedPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        warning: 'Stale Credit Direct session',
      });
    });

    it('rejects an unpersisted-reference webhook for a superseded session reference', async () => {
      const retriedOrder = {
        ...mockOrder,
        notes: JSON.stringify({
          creditDirectSessionId: 'session_B',
          creditDirectSupersededReferences: ['txn_old_session'],
        }),
      };
      const staleSessionPayload = {
        ...customerPaymentPayload,
        checkoutTransactionId: 'txn_old_session',
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(staleSessionPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [retriedOrder],
        error: null,
      });

      const request = createMockRequest(staleSessionPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        warning: 'Stale Credit Direct session',
      });
    });

    it('rejects an unpersisted-reference webhook that predates the current session', async () => {
      const resignedOrder = {
        ...mockOrder,
        notes: JSON.stringify({
          creditDirectSessionId: 'session_B',
          // Current session signed 90 minutes AFTER the payload event time.
          creditDirectSignedAt: '2024-01-15T12:00:00.000Z',
        }),
      };
      const predatedPayload = {
        ...customerPaymentPayload,
        checkoutTransactionId: 'txn_from_before_resign',
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(predatedPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [resignedOrder],
        error: null,
      });

      const request = createMockRequest(predatedPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        warning: 'Stale Credit Direct session',
      });
    });

    it('rejects a payout that only matches a tampered-low signed amount', async () => {
      const tamperedOrder = {
        ...mockOrder,
        notes: JSON.stringify({
          creditDirectSessionId: 'session_123456789',
          creditDirectTransactionId: 'txn_123456789',
          credit_directTransactionId: 'txn_123456789',
          creditDirectSignedAmount: 100,
        }),
      };
      const lowPayoutPayload = {
        ...merchantPaymentPayload,
        products: [
          {
            productName: 'Product 1',
            productAmount: 100,
            productId: 'prod_1',
          },
        ],
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(lowPayoutPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [tamperedOrder],
        error: null,
      });

      const request = createMockRequest(lowPayoutPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Payment amount mismatch' });
      expect(logger.warn).toHaveBeenCalledWith({
        message:
          'Credit Direct signed amount drifted from expected gateway amount',
        orderId: 'order_abc',
        signedAmount: 100,
        expectedGatewayAmount: 50000,
        transactionId: 'txn_123456789',
      });
    });

    it('rejects payout completion when the signed amount disagrees with the expected residual', async () => {
      const driftedOrder = {
        ...mockOrder,
        notes: JSON.stringify({
          creditDirectSessionId: 'session_123456789',
          creditDirectTransactionId: 'txn_123456789',
          credit_directTransactionId: 'txn_123456789',
          creditDirectSignedAmount: 45000,
        }),
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [driftedOrder],
            error: null,
          });
          return orderLookupChain;
        } else if (fromCallCount === 2) {
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        } else if (fromCallCount === 3) {
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: null,
          });
          return txCheckChain;
        } else if (fromCallCount === 4) {
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi.fn().mockResolvedValue({
            data: { id: 'cd-txn-1' },
            error: null,
          });
          return txInsertChain;
        }
        return mockChain;
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data).toEqual({ error: 'Payment amount mismatch' });
      expect(logger.warn).toHaveBeenCalledWith({
        message:
          'Credit Direct signed amount drifted from expected gateway amount',
        orderId: 'order_abc',
        signedAmount: 45000,
        expectedGatewayAmount: 50000,
        transactionId: 'txn_123456789',
      });
      expect(logger.info).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Credit Direct merchant payment completed',
        })
      );
    });

    it('accepts a residual payout when wallet credit covered part of the order', async () => {
      const walletPartOrder = {
        ...mockOrder,
        wallet_amount_used: 20000,
        notes: JSON.stringify({
          creditDirectSessionId: 'session_123456789',
          creditDirectTransactionId: 'txn_123456789',
          credit_directTransactionId: 'txn_123456789',
          creditDirectSignedAmount: 30000,
        }),
      };
      const residualPayload = {
        ...merchantPaymentPayload,
        products: [
          {
            productName: 'Product 1',
            productAmount: 30000,
            productId: 'prod_1',
          },
        ],
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(residualPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [walletPartOrder],
            error: null,
          });
          return orderLookupChain;
        } else if (fromCallCount === 2) {
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        } else if (fromCallCount === 3) {
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: null,
          });
          return txCheckChain;
        } else if (fromCallCount === 4) {
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi.fn().mockResolvedValue({
            data: { id: 'cd-txn-1' },
            error: null,
          });
          return txInsertChain;
        }
        return mockChain;
      });

      const request = createMockRequest(residualPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            'Credit Direct signed amount drifted from expected gateway amount',
        })
      );
      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct merchant payment completed',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
        amount: 30000,
        platformFee: 1000,
        merchantAmount: 49000,
      });
    });

    it('is idempotent when order is already paid', async () => {
      const paidOrder = { ...mockOrder, payment_status: 'paid' };

      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [paidOrder],
        error: null,
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true, message: 'Already processed' });

      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct webhook already processed (order already paid)',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
      });
      expect(mockReconciliationInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_type: 'gateway_payment_wedge_requires_review',
          order_id: 'order_abc',
          txn_id: 'txn_123456789',
        })
      );
    });

    it('is idempotent when transaction already exists', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // First from('orders') - order lookup
          const orderLookupChain = {
            ...createMockSupabaseClient().from('orders'),
          };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        } else if (fromCallCount === 2) {
          // Second from('orders') - order update (active row)
          const updateChain = { ...createMockSupabaseClient().from('orders') };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        } else if (fromCallCount === 3) {
          // Third from('transactions') - existing tx check
          const txCheckChain = {
            ...createMockSupabaseClient().from('transactions'),
          };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi.fn().mockResolvedValue({
            data: { id: 'existing_tx_123' },
            error: null,
          });
          return txCheckChain;
        }
        return createMockSupabaseClient().from(table);
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });

      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct transaction already processed (idempotent)',
        transactionId: 'txn_123456789',
        existingTxId: 'existing_tx_123',
      });
    });

    it('returns 500 when the existing-transaction lookup fails with a real error', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // order lookup
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          // order update (active row)
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.in = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        }
        if (fromCallCount === 3) {
          // existing-transaction lookup: a transient read failure, NOT the
          // PostgREST no-rows error, must not fall through to the insert path
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: { code: '57014', message: 'statement timeout' },
          });
          return txCheckChain;
        }
        throw new Error(`Unexpected from() call ${fromCallCount}`);
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to record transaction' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Failed to look up existing Credit Direct transaction',
        error: { code: '57014', message: 'statement timeout' },
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
      });
    });

    it('returns 500 when the transaction insert fails with a non-unique-violation error', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.in = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        }
        if (fromCallCount === 3) {
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi
            .fn()
            .mockResolvedValue({ data: null, error: null });
          return txCheckChain;
        }
        if (fromCallCount === 4) {
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'ETIMEDOUT', message: 'connection lost' },
          });
          return txInsertChain;
        }
        throw new Error(`Unexpected from() call ${fromCallCount}`);
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Failed to record transaction' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Failed to create transaction record',
        error: { code: 'ETIMEDOUT', message: 'connection lost' },
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
      });
    });

    it('treats a unique-violation on transaction insert as success (concurrent delivery already recorded it)', async () => {
      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [mockOrder],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.in = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'order_abc',
              shipping_status: 'processing',
              cancelled_at: null,
            },
            error: null,
          });
          return updateChain;
        }
        if (fromCallCount === 3) {
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi
            .fn()
            .mockResolvedValue({ data: null, error: null });
          return txCheckChain;
        }
        if (fromCallCount === 4) {
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi.fn().mockResolvedValue({
            data: null,
            error: { code: '23505', message: 'duplicate key value' },
          });
          return txInsertChain;
        }
        return mockChain;
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });
      expect(logger.info).toHaveBeenCalledWith({
        message:
          'Credit Direct transaction insert raced a concurrent delivery (unique violation)',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
      });
      expect(logger.info).toHaveBeenCalledWith({
        message: 'Credit Direct merchant payment completed',
        orderId: 'order_abc',
        transactionId: 'txn_123456789',
        amount: 50000,
        platformFee: 1000,
        merchantAmount: 49000,
      });
    });

    it('heals the missing transaction row when replaying an already-paid order with recorded fee notes', async () => {
      const paidOrderWithFeeNotes = {
        ...mockOrder,
        payment_status: 'paid',
        notes: JSON.stringify({
          creditDirectSessionId: 'session_123456789',
          creditDirectTransactionId: 'txn_123456789',
          credit_directTransactionId: 'txn_123456789',
          creditDirectSignedAmount: 50000,
          creditDirectClientCompletionStatus: 'provider_confirmed',
          creditDirectProviderConfirmedAt: '2024-01-15T11:00:00Z',
          // Written by the paid flip: notifications were queued but the
          // dispatch marker never landed — the crash window this replay
          // heals.
          creditDirectNotificationsQueued: true,
          merchantPaidAt: '2024-01-15T11:00:00Z',
          platformFee: 1000,
          merchantAmount: 49000,
        }),
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const transactionInsert = vi.fn().mockReturnThis();
      const notifiedMarkerUpdate = vi.fn().mockReturnThis();
      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          // order lookup — already paid from a prior delivery
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [paidOrderWithFeeNotes],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          // healing lookup — the prior delivery's insert never landed
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi
            .fn()
            .mockResolvedValue({ data: null, error: null });
          return txCheckChain;
        }
        if (fromCallCount === 3) {
          // healing insert
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = transactionInsert;
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi
            .fn()
            .mockResolvedValue({ data: { id: 'healed-tx-1' }, error: null });
          return txInsertChain;
        }
        if (fromCallCount === 4) {
          // notification marker write — the crashed first delivery never
          // dispatched push/email, so the replay does and records it.
          const markerChain = { ...mockChain };
          markerChain.update = notifiedMarkerUpdate;
          markerChain.eq = vi.fn().mockResolvedValue({ error: null });
          return markerChain;
        }
        throw new Error(`Unexpected from() call ${fromCallCount}`);
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true, message: 'Already processed' });
      const notifiedUpdate = notifiedMarkerUpdate.mock.calls[0]?.[0] as
        | { notes?: string }
        | undefined;
      expect(JSON.parse(notifiedUpdate?.notes ?? '{}')).toEqual(
        expect.objectContaining({
          creditDirectClientCompletionStatus: 'provider_confirmed',
          creditDirectNotifiedAt: expect.any(String),
          creditDirectVerifiedWebhookWrite: true,
        })
      );
      expect(transactionInsert).toHaveBeenCalledWith({
        merchant_id: 'merchant_123',
        order_id: 'order_abc',
        transaction_type: 'payment',
        amount: 50000,
        currency: 'NGN',
        status: 'completed',
        gateway: 'credit_direct',
        gateway_reference: 'txn_123456789',
        gateway_response: merchantPaymentPayload,
        platform_fee: 1000,
        merchant_amount: 49000,
      });
    });

    it('keeps a refunded order refunded but records and files the disbursed payout', async () => {
      const refundedOrder = { ...mockOrder, payment_status: 'refunded' };
      const transactionInsert = vi.fn().mockReturnThis();

      vi.mocked(parseWebhookPayload).mockReturnValue(merchantPaymentPayload);

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      let fromCallCount = 0;
      supabaseMock.from.mockImplementation((_table: string) => {
        fromCallCount++;
        if (fromCallCount === 1) {
          const orderLookupChain = { ...mockChain };
          orderLookupChain.select = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.eq = vi.fn().mockReturnValue(orderLookupChain);
          orderLookupChain.ilike = vi.fn().mockResolvedValue({
            data: [refundedOrder],
            error: null,
          });
          return orderLookupChain;
        }
        if (fromCallCount === 2) {
          // The .in(payment_status) guard excludes 'refunded', so the update
          // matches 0 rows — simulated here via a null maybeSingle() result.
          const updateChain = { ...mockChain };
          updateChain.update = vi.fn().mockReturnValue(updateChain);
          updateChain.eq = vi.fn().mockReturnValue(updateChain);
          updateChain.in = vi.fn().mockReturnValue(updateChain);
          updateChain.select = vi.fn().mockReturnValue(updateChain);
          updateChain.maybeSingle = vi
            .fn()
            .mockResolvedValue({ data: null, error: null });
          return updateChain;
        }
        if (fromCallCount === 3) {
          // Re-read confirming the order is refunded (not concurrently paid).
          const rereadChain = { ...mockChain };
          rereadChain.select = vi.fn().mockReturnValue(rereadChain);
          rereadChain.eq = vi.fn().mockReturnValue(rereadChain);
          rereadChain.maybeSingle = vi.fn().mockResolvedValue({
            data: { payment_status: 'refunded' },
            error: null,
          });
          return rereadChain;
        }
        if (fromCallCount === 4) {
          // Existing-transaction lookup inside recordCreditDirectTransaction.
          const txCheckChain = { ...mockChain };
          txCheckChain.select = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.eq = vi.fn().mockReturnValue(txCheckChain);
          txCheckChain.single = vi
            .fn()
            .mockResolvedValue({ data: null, error: null });
          return txCheckChain;
        }
        if (fromCallCount === 5) {
          const txInsertChain = { ...mockChain };
          txInsertChain.insert = transactionInsert;
          txInsertChain.select = vi.fn().mockReturnValue(txInsertChain);
          txInsertChain.single = vi
            .fn()
            .mockResolvedValue({ data: { id: 'refund-tx-1' }, error: null });
          return txInsertChain;
        }
        throw new Error(`Unexpected from() call ${fromCallCount}`);
      });

      const request = createMockRequest(merchantPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      // The order stays refunded, but the disbursed money is persisted and
      // filed for ops review — never a silent ack.
      expect(response.status).toBe(200);
      expect(data).toEqual({
        received: true,
        message: 'Order was refunded; payment filed for review',
      });
      expect(transactionInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          gateway: 'credit_direct',
          gateway_reference: 'txn_123456789',
          order_id: 'order_abc',
          status: 'completed',
        })
      );
      expect(mockReconciliationInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          issue_type: 'payment_received_after_refund',
          order_id: 'order_abc',
          txn_id: 'refund-tx-1',
        })
      );
    });
  });

  describe('Unknown Event Types', () => {
    it('handles unknown event types gracefully', async () => {
      const unknownEventPayload = {
        ...customerPaymentPayload,
        eventType: 'Unknown_Event_Type',
      };

      vi.mocked(parseWebhookPayload).mockReturnValue(
        unknownEventPayload as never
      );

      const supabaseMock = createMockSupabaseClient();
      vi.mocked(createServiceClient).mockReturnValue(supabaseMock as never);

      const mockChain = supabaseMock.from('orders');
      mockChain.select.mockReturnValue(mockChain);
      mockChain.eq.mockReturnValue(mockChain);
      mockChain.ilike.mockResolvedValue({
        data: [mockOrder],
        error: null,
      });

      const request = createMockRequest(unknownEventPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({ received: true });

      expect(logger.warn).toHaveBeenCalledWith({
        message: 'Unknown Credit Direct webhook event type',
        eventType: 'Unknown_Event_Type',
      });
    });
  });

  describe('Error Handling', () => {
    it('returns 500 on unexpected errors', async () => {
      // Make getWebhookSecret throw AFTER signature verification
      vi.mocked(getWebhookSecret).mockReturnValue('webhook_secret');
      vi.mocked(parseWebhookPayload).mockReturnValue(customerPaymentPayload);

      // Make createServiceClient throw to trigger the outer catch block
      vi.mocked(createServiceClient).mockImplementation(() => {
        throw new Error('Unexpected database error');
      });

      const request = createMockRequest(customerPaymentPayload);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({ error: 'Webhook processing failed' });
      expect(logger.error).toHaveBeenCalledWith({
        message: 'Credit Direct webhook error',
        error: expect.any(Error),
      });
    });
  });
});
