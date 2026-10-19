import { NextRequest } from 'next/server';
import { vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/env', () => ({
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
}));

const {
  mockAuthenticateApiRequest,
  mockCreatePaystackDvaReservationProof,
  mockGetUserAccess,
  mockGeneratePaymentAccount,
  mockFrom,
  mockRpc,
  mockSupabaseClient,
} = vi.hoisted(() => {
  const mockFrom = vi.fn();
  const mockRpc = vi.fn().mockResolvedValue({ error: null });
  return {
    mockAuthenticateApiRequest: vi.fn(),
    mockCreatePaystackDvaReservationProof: vi.fn(() => ({
      account_name: 'Ogabassey/John Doe',
      account_number: '9876543210',
      assigned_at: '2026-08-25T12:00:00.000Z',
      bank_name: 'Wema Bank',
      customer_email: 'john@test.com',
      expires_at: '2026-08-25T13:30:00.000Z',
      issued_at: '2026-08-25T12:00:01.000Z',
      order_id: '550e8400-e29b-41d4-a716-446655440000',
      scope: 'paystack_dva_reservation',
      signature: 'a'.repeat(64),
      version: 'paystack-dva-reservation:v1',
    })),
    mockGetUserAccess: vi.fn(),
    mockGeneratePaymentAccount: vi.fn(),
    mockFrom,
    mockRpc,
    mockSupabaseClient: {
      auth: { getUser: vi.fn() },
      from: mockFrom,
      rpc: mockRpc,
    },
  };
});

export const generateDvaTestMocks = {
  mockAuthenticateApiRequest,
  mockCreatePaystackDvaReservationProof,
  mockGeneratePaymentAccount,
  mockGetUserAccess,
  mockRpc,
};

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mockAuthenticateApiRequest,
  getUserAccess: mockGetUserAccess,
}));

vi.mock('@/lib/paystack', () => ({
  generatePaymentAccount: mockGeneratePaymentAccount,
}));

vi.mock('@/lib/payments/paystack-dva-reservation-proof', () => ({
  createPaystackDvaReservationProof: mockCreatePaystackDvaReservationProof,
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { POST } from './route';

export function postGenerateDva(...args: Parameters<typeof POST>) {
  return POST(...args);
}

export const ORDER_ID = '550e8400-e29b-41d4-a716-446655440000';
export const MERCHANT_ID = 'merchant-123';

export function createRequest(): NextRequest {
  return new NextRequest(
    `http://localhost/api/orders/${ORDER_ID}/generate-dva`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

export function createParams(id = ORDER_ID) {
  return { params: Promise.resolve({ id }) };
}

function mockQuery(
  data: unknown,
  error: unknown = null,
  writeError: unknown = null
) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue({ data, error }),
    neq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
    insert: vi.fn().mockResolvedValue({ error: writeError }),
    maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    upsert: vi.fn().mockResolvedValue({ error: writeError }),
    update: vi.fn().mockReturnThis(),
  };
}

export const unpaidOrder = {
  id: ORDER_ID,
  order_number: 'ORD-001',
  total: '5000',
  amount_paid: '0',
  wallet_amount_used: '0',
  customer_name: 'John Doe',
  customer_email: 'john@test.com',
  customer_phone: '+2348012345678',
  payment_status: 'unpaid',
  shipping_status: 'pending',
  cancelled_at: null,
  currency: 'NGN',
  merchant_id: MERCHANT_ID,
};

export const generatedDva = {
  success: true,
  data: {
    account_number: '9876543210',
    account_name: 'Ogabassey/John Doe',
    bank_name: 'Wema Bank',
    customer_code: 'CUS_test123',
  },
};

export function authenticateMerchant(merchantId: string | null = MERCHANT_ID) {
  mockAuthenticateApiRequest.mockResolvedValue({
    user: { id: 'user-1' },
    error: null,
    supabase: mockSupabaseClient,
  });
  mockGetUserAccess.mockResolvedValue(
    merchantId
      ? {
          isOwner: true,
          isStaff: false,
          merchantId,
          permissions: {},
          role: 'owner',
        }
      : null
  );
}

export function useOrderQueries({
  featureSettings = { paystack_enabled: true },
  order = unpaidOrder,
  orderError = null,
  paymentAccount = null,
  paymentAccountError = null,
  transactions = [],
  writeError = null,
}: {
  featureSettings?: unknown;
  order?: unknown;
  orderError?: unknown;
  paymentAccount?: unknown;
  paymentAccountError?: unknown;
  transactions?: unknown[];
  writeError?: unknown;
} = {}) {
  const orderQuery = mockQuery(order, orderError);
  const featureSettingsQuery = mockQuery(featureSettings);
  const transactionsQuery = mockQuery(transactions);
  const paymentAccountQuery = mockQuery(
    paymentAccount,
    paymentAccountError,
    writeError
  );
  mockFrom.mockImplementation((table: string) => {
    if (table === 'orders') return orderQuery;
    if (table === 'merchant_feature_settings') return featureSettingsQuery;
    if (table === 'transactions') return transactionsQuery;
    return paymentAccountQuery;
  });
  return paymentAccountQuery;
}

export function resetGenerateDvaMocks() {
  vi.clearAllMocks();
  mockRpc.mockImplementation((name: string) =>
    Promise.resolve({
      data:
        name === 'reserve_paystack_order_payment_account' ? 'inserted' : 5000,
      error: null,
    })
  );
}
